"""Untrusted bytes are data only. The container supplies the process/resource boundary."""
import binascii
import datetime
import hashlib
import json
import os
import pathlib
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import warnings
import zipfile
import zlib

MAX_ENTRIES = 10000
MAX_ENTRY = 500000000
MAX_TOTAL = 2000000000
MAX_RATIO = 100
MAX_IMAGE_PIXELS = 40000000
MAX_SIGNATURE_AGE_SECONDS = 7 * 86400


class UnsafeFile(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise UnsafeFile(reason)


def archive_magic(data):
    return (data.startswith((b'PK\x03\x04', b'PK\x05\x06', b'PK\x07\x08', b'\x1f\x8b',
                            b'BZh', b'\xfd7zXZ\x00', b'7z\xbc\xaf\x27\x1c', b'Rar!', b'\x28\xb5\x2f\xfd'))
            or data[257:262] == b'ustar')


def checked_name(info):
    name = unicodedata.normalize('NFKC', info.orig_filename)
    require(name and '\\' not in name and '\x00' not in name and
            not re.search(r'[\x00-\x1f\x7f]', name), 'ZIP_PATH')
    require(not name.startswith('/') and not re.match(r'^[a-zA-Z]:', name), 'ZIP_PATH')
    parts = name.rstrip('/').split('/')
    require(all(p not in ('', '.', '..') for p in parts), 'ZIP_PATH')
    mode = info.external_attr >> 16
    kind = stat.S_IFMT(mode)
    require(kind in (0, stat.S_IFREG, stat.S_IFDIR), 'ZIP_SPECIAL_FILE')
    require(not name.lower().endswith(('.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.zst')), 'ZIP_NESTED')
    return name


def check_extra(extra, raw_name, name):
    position = 0
    seen = set()
    while position < len(extra):
        require(position + 4 <= len(extra), 'ZIP_EXTRA')
        kind, size = struct.unpack_from('<HH', extra, position)
        position += 4
        require(position + size <= len(extra) and kind not in seen, 'ZIP_EXTRA')
        value = extra[position:position+size]
        seen.add(kind)
        position += size
        if kind == 0x7075:
            require(len(value) >= 5 and value[0] == 1 and
                    struct.unpack_from('<I', value, 1)[0] == binascii.crc32(raw_name), 'ZIP_EXTRA_PATH')
            require(unicodedata.normalize('NFKC', value[5:].decode('utf-8')) == name, 'ZIP_EXTRA_PATH')
        elif kind == 0x5455:
            require(len(value) in (1, 5, 9, 13) and value[0] & ~7 == 0, 'ZIP_EXTRA_TIMESTAMP')
        elif kind == 0x000a:
            require(len(value) >= 4, 'ZIP_EXTRA_NTFS')
            cursor = 4
            while cursor < len(value):
                require(cursor + 4 <= len(value), 'ZIP_EXTRA_NTFS')
                tag, count = struct.unpack_from('<HH', value, cursor)
                require(tag == 1 and count == 24 and cursor+4+count <= len(value), 'ZIP_EXTRA_NTFS')
                cursor += 4+count
        elif kind == 0x7875:
            require(len(value) >= 5 and value[0] == 1, 'ZIP_EXTRA_UNIX')
            uid = value[1]
            require(1 <= uid <= 8 and 2+uid < len(value), 'ZIP_EXTRA_UNIX')
            gid = value[2+uid]
            require(1 <= gid <= 8 and len(value) == 3+uid+gid, 'ZIP_EXTRA_UNIX')
        else:
            raise UnsafeFile('ZIP_UNSUPPORTED_EXTRA')


def check_zip(path, scan_member=None):
    """Use central metadata for bounds, but count actual input/output and verify CRC."""
    total = 0
    compressed_total = 0
    member = None
    coverage = hashlib.sha256()
    try:
        with zipfile.ZipFile(path) as archive, open(path, 'rb') as source:
            infos = archive.infolist()
            require(0 < len(infos) <= MAX_ENTRIES, 'ZIP_ENTRIES')
            names = set()
            ranges = []
            directory_start = archive.start_dir
            for info in infos:
                name = checked_name(info)
                require(name not in names, 'ZIP_DUPLICATE_PATH')
                names.add(name)
                require(info.flag_bits & ~0x80e == 0, 'ZIP_ENCRYPTED_OR_UNSUPPORTED_FLAGS')
                require(info.compress_type in (0, 8), 'ZIP_UNSUPPORTED_METHOD')
                require(info.file_size <= MAX_ENTRY and total + info.file_size <= MAX_TOTAL, 'ZIP_SIZE')
                require(info.header_offset >= 0 and info.header_offset < directory_start, 'ZIP_OFFSETS')
                # Only understood extras are accepted; Unicode path aliases must
                # agree with the canonical validated filename.
                central_name = info.orig_filename.encode('utf-8' if info.flag_bits & 0x800 else 'cp437')
                check_extra(info.extra, central_name, name)
                source.seek(info.header_offset)
                header = source.read(30)
                require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'ZIP_HEADER')
                fields = struct.unpack('<IHHHHHIIIHH', header)
                flags, method, local_crc, local_compressed, local_plain = fields[2], fields[3], fields[6], fields[7], fields[8]
                require(flags == info.flag_bits and method == info.compress_type, 'ZIP_HEADER_MISMATCH')
                raw_name = source.read(fields[9])
                local_extra = source.read(fields[10])
                require(len(raw_name) == fields[9] and len(local_extra) == fields[10], 'ZIP_HEADER')
                decoded = raw_name.decode('utf-8' if flags & 0x800 else 'cp437')
                require(decoded == info.orig_filename, 'ZIP_HEADER_NAME')
                check_extra(local_extra, raw_name, name)
                if not flags & 8:
                    require((local_crc, local_compressed, local_plain) == (info.CRC, info.compress_size, info.file_size), 'ZIP_HEADER_SIZE')
                start = source.tell()
                require(start + info.compress_size <= directory_start, 'ZIP_OFFSETS')
                decoder = zlib.decompressobj(-15) if method == 8 else None
                left = info.compress_size
                actual_input = 0
                actual_output = 0
                crc = 0
                prefix = bytearray()
                if scan_member:
                    member = tempfile.TemporaryFile(dir='/tmp')
                member_hash = hashlib.sha256()
                # Every compressed byte is read; decompressed output is capped per step.
                while left:
                    chunk = source.read(min(65536, left))
                    require(chunk, 'ZIP_TRUNCATED')
                    left -= len(chunk)
                    actual_input += len(chunk)
                    pending = chunk
                    while pending:
                        if decoder:
                            out = decoder.decompress(pending, 65536)
                            pending = decoder.unconsumed_tail
                        else:
                            out, pending = pending, b''
                        actual_output += len(out)
                        total += len(out)
                        crc = binascii.crc32(out, crc)
                        member_hash.update(out)
                        if len(prefix) < 512:
                            prefix.extend(out[:512-len(prefix)])
                        require(actual_output <= MAX_ENTRY and total <= MAX_TOTAL, 'ZIP_SIZE')
                        require(actual_input != 0 or actual_output == 0, 'ZIP_RATIO')
                        # Use consumed compressed bytes, excluding any read-ahead still buffered.
                        consumed = actual_input - len(pending) - (len(decoder.unused_data) if decoder else 0)
                        require(actual_output == 0 or consumed > 0 and actual_output <= consumed * MAX_RATIO, 'ZIP_RATIO')
                        require(not archive_magic(prefix), 'ZIP_NESTED')
                        if member is not None:
                            member.write(out)
                if decoder:
                    require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, 'ZIP_DEFLATE')
                require(actual_input == info.compress_size and actual_output == info.file_size and crc & 0xffffffff == info.CRC, 'ZIP_INTEGRITY')
                require(not info.is_dir() or actual_output == 0, 'ZIP_DIRECTORY_DATA')
                require(actual_output == 0 or actual_input > 0 and actual_output <= actual_input * MAX_RATIO, 'ZIP_RATIO')
                compressed_total += actual_input
                require(total == 0 or compressed_total > 0 and total <= compressed_total * MAX_RATIO, 'ZIP_RATIO')
                if flags & 8:
                    descriptor = source.read(4)
                    if descriptor == b'PK\x07\x08':
                        descriptor = source.read(12)
                    else:
                        descriptor += source.read(8)
                    require(len(descriptor) == 12 and struct.unpack('<III', descriptor) == (info.CRC, actual_input, actual_output), 'ZIP_DESCRIPTOR')
                if member is not None:
                    member.seek(0)
                    scan_member(member, name, actual_output)
                    member.close()
                    member = None
                coverage.update(json.dumps([name, actual_output, member_hash.hexdigest()],
                                           ensure_ascii=True, separators=(',', ':')).encode() + b'\n')
                ranges.append((info.header_offset, source.tell()))
            ranges.sort()
            require(ranges[0][0] == 0, 'ZIP_PREFIX')
            for index, (start, end) in enumerate(ranges):
                require(end == (ranges[index+1][0] if index+1 < len(ranges) else directory_start), 'ZIP_GAPS_OR_OVERLAP')
            # zipfile accepts appended bytes; this private-file profile does not.
            source.seek(-min(os.path.getsize(path), 65557), os.SEEK_END)
            tail = source.read()
            end = tail.rfind(b'PK\x05\x06')
            require(end >= 0 and end + 22 <= len(tail), 'ZIP_END')
            comment = struct.unpack_from('<H', tail, end+20)[0]
            require(end+22+comment == len(tail), 'ZIP_TRAILING')
            return {'entries': len(infos), 'expandedBytes': total, 'sha256': coverage.hexdigest()}
    except UnsafeFile:
        raise
    except (zipfile.BadZipFile, UnicodeError, OSError, ValueError, zlib.error, struct.error) as error:
        raise UnsafeFile('ZIP_STRUCTURE') from error
    finally:
        if member is not None:
            member.close()


def run_limited(arguments, limit=1048576):
    process = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    data = bytearray()
    try:
        while True:
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            data.extend(chunk)
            require(len(data) <= limit, 'CHECKER_OUTPUT_LIMIT')
        code = process.wait()
        return code, bytes(data)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def check_pdf(path):
    with open(path, 'rb') as source:
        require(source.read(8).startswith(b'%PDF-'), 'PDF_SIGNATURE')
    code, _ = run_limited(['qpdf', '--check', path])
    require(code == 0, 'PDF_STRUCTURE')
    code, data = run_limited(['qpdf', '--json', '--json-stream-data=none', path], 8000000)
    require(code == 0, 'PDF_STRUCTURE')
    document = json.loads(data)
    forbidden = {'/JavaScript', '/JS', '/AA', '/OpenAction', '/Launch', '/EmbeddedFiles',
                 '/RichMedia', '/XFA', '/AcroForm', '/SubmitForm', '/ImportData', '/GoToR', '/URI'}
    def walk(value):
        if isinstance(value, dict):
            require(not forbidden.intersection(value), 'PDF_ACTIVE_CONTENT')
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str):
            require(value not in forbidden, 'PDF_ACTIVE_CONTENT')
    require(not document.get('encrypt', {}).get('encrypted', False), 'PDF_ENCRYPTED')
    walk(document)


def check_image(path, expected):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    with Image.open(path) as image:
        require(image.format == expected and image.width * image.height <= MAX_IMAGE_PIXELS, 'IMAGE_TYPE_OR_PIXELS')
        image.verify()
    with Image.open(path) as image:
        image.load()
    if expected == 'PNG':
        with open(path, 'rb') as source:
            require(source.read(8) == b'\x89PNG\r\n\x1a\n', 'IMAGE_SIGNATURE')
            while True:
                header = source.read(8)
                require(len(header) == 8, 'PNG_STRUCTURE')
                length, kind = struct.unpack('>I4s', header)
                require(length <= 20000000, 'PNG_CHUNK')
                chunk = source.read(length)
                crc = source.read(4)
                require(len(chunk) == length and len(crc) == 4 and struct.unpack('>I', crc)[0] == binascii.crc32(kind+chunk) & 0xffffffff, 'PNG_CRC')
                if kind == b'IEND':
                    require(length == 0 and not source.read(1), 'PNG_TRAILING')
                    break
    else:
        with open(path, 'rb') as source:
            require(source.read(2) == b'\xff\xd8', 'JPEG_SIGNATURE')
            source.seek(-2, os.SEEK_END)
            require(source.read(2) == b'\xff\xd9', 'JPEG_TRAILING')


def malware(path, zip_archive=False):
    code, version = run_limited(['clamscan', '--version'])
    require(code == 0, 'MALWARE_ENGINE_UNAVAILABLE')
    text = version.decode('utf-8', 'replace').strip()
    parts = text.split('/')
    require(len(parts) >= 3, 'MALWARE_DATABASE_UNAVAILABLE')
    date = datetime.datetime.strptime(parts[-1].strip(), '%a %b %d %H:%M:%S %Y').replace(tzinfo=datetime.timezone.utc)
    require(-86400 <= time.time()-date.timestamp() <= MAX_SIGNATURE_AGE_SECONDS, 'MALWARE_DATABASE_STALE')
    # ClamAV counts text/PDF normalization as recursion too. Nested archives are
    # rejected independently by check_zip; this is a bounded engine budget.
    # MaxScanSize includes compressed input plus recursively extracted bytes.
    # check_zip still independently rejects actual expansion above 2GB.
    scan_budget = 2500000000 if zip_archive else 2000000000
    arguments = ['clamscan', '--no-summary', '--stdout', '--disable-cache', '--max-filesize=500000000',
                          f'--max-scansize={scan_budget}', '--max-files=10000', '--max-recursion=10',
                          '--max-scantime=120000', '--alert-exceeds-max=yes', '--alert-encrypted=yes']
    code, scan = run_limited(arguments + [path])
    if b'Heuristics.Limits.Exceeded' in scan:
        raise UnsafeFile('MALWARE_SCAN_LIMIT')
    require(code == 0, 'MALWARE_DETECTED' if code == 1 else 'MALWARE_SCAN_INCOMPLETE')
    return {'clean': True, 'engine': 'ClamAV', 'version': text, 'signatureDate': date.isoformat()}


def malware_zip(path):
    # Keep original native archive/context detection and recursive normalization.
    coverage = check_zip(path)
    antivirus = malware(path, zip_archive=True)
    return {**antivirus, 'scope': 'whole-container-recursive', 'members': coverage}


def main():
    start = time.monotonic()
    path, mime = sys.argv[1:3]
    report = {'status': 'rejected', 'reason': 'CHECK_FAILED'}
    try:
        require(path == '/input/object' and mime in ('application/pdf', 'image/png', 'image/jpeg', 'application/zip'), 'CHECK_INPUT')
        size = os.path.getsize(path)
        require(0 < size <= (500000000 if mime == 'application/zip' else 20000000), 'FILE_SIZE')
        if mime == 'application/zip':
            antivirus = malware_zip(path)
        elif mime == 'application/pdf':
            check_pdf(path)
        else:
            check_image(path, 'PNG' if mime == 'image/png' else 'JPEG')
        if mime != 'application/zip':
            antivirus = malware(path)
        digest = hashlib.sha256()
        with open(path, 'rb') as source:
            for chunk in iter(lambda: source.read(65536), b''):
                digest.update(chunk)
        report = {'status': 'clean', 'reason': 'CHECKS_PASSED', 'bytes': size, 'sha256': digest.hexdigest(),
                  'contentType': mime, 'structural': True, 'malware': antivirus}
    except UnsafeFile as error:
        report = {'status': 'rejected', 'reason': str(error)}
    except Exception:
        report = {'status': 'rejected', 'reason': 'CHECK_INCOMPLETE'}
    report['elapsedMs'] = int((time.monotonic()-start)*1000)
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    signal.alarm(120)
    main()

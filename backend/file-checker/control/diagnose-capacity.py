"""Diagnostic only: preserve real engine exit/output; never used by application."""
import hashlib
import json
import os
import signal
import sys
import time
sys.path.insert(0, '/checker')
from file_checker import check_zip, run_limited

signal.alarm(120)
path = '/input/object'
started = time.monotonic()
check_zip(path)
arguments = ['clamscan', '--no-summary', '--stdout', '--max-filesize=500000000',
             '--max-scansize=2000000000', '--max-files=10000', '--max-recursion=10',
             '--max-scantime=120000', '--alert-exceeds-max=yes', '--alert-encrypted=yes', path]
code, output = run_limited(arguments)
hash_value = hashlib.sha256()
with open(path, 'rb') as source:
    for chunk in iter(lambda: source.read(65536), b''):
        hash_value.update(chunk)
print(json.dumps({'bytes': os.path.getsize(path), 'sha256': hash_value.hexdigest(),
                  'structural': True, 'engineArguments': arguments, 'engineExit': code,
                  'engineOutput': output.decode('utf-8', 'replace'),
                  'completeCleanScan': code == 0,
                  'elapsedMs': int((time.monotonic()-started)*1000)}))

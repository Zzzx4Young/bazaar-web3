"""Resource-test fixture, no fabricated verdicts and no application use."""
import pathlib
import subprocess
import sys
import time

assert sys.argv[1:] == ['/input/object', 'application/zip']
mode = pathlib.Path('/input/object').read_bytes()
if mode == b'sleep':
    child = subprocess.Popen(['python3', '-c', 'import time; time.sleep(300)'])
    print('CONTROL_CHILD_STARTED', child.pid, flush=True)
    time.sleep(300)
elif mode == b'memory':
    # Delay lets the independent observer capture the live cgroup. Each page is
    # actually written; allocation continues until the kernel OOM killer acts.
    time.sleep(1)
    blocks = []
    while True:
        blocks.append(bytearray(b'x' * 4_000_000))
        time.sleep(0.02)
else:
    raise SystemExit('Unknown control input')

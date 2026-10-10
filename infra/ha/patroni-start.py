import json
import os
import pathlib
import pwd
import socket
import time
import urllib.request
from watchdog_policy import configure_watchdog

os.umask(0o077)
config = json.loads(pathlib.Path('/opt/ha/patroni.json').read_text())
configure_watchdog(config, os.environ)
name = os.environ['HA_NODE_NAME']
config['name'] = name
config['restapi']['connect_address'] = f'{name}:8008'
config['postgresql']['connect_address'] = f'{name}:5432'
# This isolated Compose topology never replaces its etcd members. Resolve their live IPv4
# addresses once so stopping a container cannot turn a bounded DCS call into slow DNS retries.
# Suppress discovery of the advertised hostnames; keep all three configured endpoints.
config['etcd3']['hosts'] = [
    f'{socket.gethostbyname(host)}:{port}'
    for host, port in (endpoint.rsplit(':', 1) for endpoint in config['etcd3']['hosts'])
]
config['etcd3']['use_proxies'] = True
# A new etcd cluster can report the initial 3.0 cluster version briefly after health is OK.
# Patroni would then select the removed /v3alpha API and retain it in fixed-endpoint mode.
minimum_etcd_cluster_version = (3, 4)
etcd_bootstrap_budget_seconds = 30
deadline = time.monotonic() + etcd_bootstrap_budget_seconds
while True:
    ready = True
    for endpoint in config['etcd3']['hosts']:
        try:
            with urllib.request.urlopen(f'http://{endpoint}/version', timeout=1) as response:
                version = json.load(response)['etcdcluster']
            ready = ready and tuple(map(int, version.split('.')[:2])) >= minimum_etcd_cluster_version
        except (OSError, ValueError, KeyError):
            ready = False
    if ready:
        break
    if time.monotonic() >= deadline:
        raise RuntimeError('etcd cluster did not become ready for its stable v3 API')
    time.sleep(0.25)
for role, secret in [('superuser', 'ha_admin_password'), ('replication', 'ha_replication_password')]:
    config['postgresql']['authentication'][role]['password'] = pathlib.Path(f'/run/secrets/{secret}').read_text().strip()
config['restapi']['authentication']['password'] = pathlib.Path('/run/secrets/ha_rest_password').read_text().strip()
user = pwd.getpwnam('postgres')
data = pathlib.Path(config['postgresql']['data_dir'])
data.mkdir(parents=True, exist_ok=True)
os.chown(data.parent, user.pw_uid, user.pw_gid)
os.chown(data, user.pw_uid, user.pw_gid)
data.chmod(0o700)
config_directory = pathlib.Path('/var/run/ha-patroni')
config_directory.mkdir(mode=0o700, exist_ok=True)
config_directory.chmod(0o700)
os.chown(config_directory, user.pw_uid, user.pw_gid)
target = config_directory / 'config.json'
target.write_text(json.dumps(config))
target.chmod(0o600)
os.chown(target, user.pw_uid, user.pw_gid)
os.execvp('gosu', ['gosu', 'postgres', '/opt/patroni/bin/patroni', str(target)])

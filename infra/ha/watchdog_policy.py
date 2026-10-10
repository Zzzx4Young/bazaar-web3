import re


def configure_watchdog(config, env):
    if any(key.startswith('PATRONI_') for key in env):
        raise ValueError('Native Patroni environment overrides are not supported by this launcher')
    mode = env.get('HA_WATCHDOG_MODE', 'required')
    local = env.get('HA_LOCAL_VALIDATION', '0')
    if mode not in ('required', 'off') or local not in ('0', '1'):
        raise ValueError('Invalid watchdog mode or local validation control')
    if mode == 'off' and not (
        local == '1'
        and config.get('scope') == 'bazaar-ha-auto-validation'
        and config.get('namespace') == '/bazaar-ha/'
    ):
        raise ValueError('Watchdog off is restricted to explicit local validation')
    device = env.get('HA_WATCHDOG_DEVICE', '/dev/watchdog')
    if not isinstance(device, str) or not re.fullmatch(r'/dev/watchdog[0-9]*', device):
        raise ValueError('Watchdog requires a Linux watchdog device path')
    dcs = config['bootstrap']['dcs']
    ttl, loop, retry = (dcs[key] for key in ('ttl', 'loop_wait', 'retry_timeout'))
    if any(type(value) is not int or value <= 0 for value in (ttl, loop, retry)):
        raise ValueError('Watchdog timing requires positive integer seconds')
    if loop + 2 * retry > ttl or ttl // 2 <= loop + retry:
        raise ValueError('Half-TTL watchdog must leave time for the HA loop and DCS retry')
    config['watchdog'] = (
        {'mode': 'required', 'device': device, 'safety_margin': -1}
        if mode == 'required' else {'mode': 'off'}
    )

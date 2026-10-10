import copy
import json
import pathlib
import unittest

from watchdog_policy import configure_watchdog


class WatchdogPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads(pathlib.Path(__file__).with_name('patroni.json').read_text())

    def test_default_requires_protection(self):
        configure_watchdog(self.config, {})
        self.assertEqual(self.config['watchdog'], {
            'mode': 'required', 'device': '/dev/watchdog', 'safety_margin': -1
        })

    def test_off_requires_explicit_local_validation(self):
        for env in ({'HA_WATCHDOG_MODE': 'off'},
                    {'HA_WATCHDOG_MODE': 'off', 'HA_LOCAL_VALIDATION': '0'}):
            with self.assertRaises(ValueError):
                configure_watchdog(copy.deepcopy(self.config), env)
        configure_watchdog(self.config, {'HA_WATCHDOG_MODE': 'off', 'HA_LOCAL_VALIDATION': '1'})
        self.assertEqual(self.config['watchdog'], {'mode': 'off'})

    def test_local_exemption_cannot_cover_another_cluster(self):
        self.config['scope'] = 'production'
        with self.assertRaises(ValueError):
            configure_watchdog(self.config, {'HA_WATCHDOG_MODE': 'off', 'HA_LOCAL_VALIDATION': '1'})

    def test_optional_protection_and_invalid_controls_are_rejected(self):
        for env in ({'HA_WATCHDOG_MODE': 'automatic'},
                    {'HA_LOCAL_VALIDATION': 'yes'},
                    {'HA_WATCHDOG_DEVICE': '/tmp/watchdog'},
                    {'HA_WATCHDOG_DEVICE': '/dev/watchdog/../null'}):
            with self.assertRaises(ValueError):
                configure_watchdog(copy.deepcopy(self.config), env)

    def test_native_environment_cannot_bypass_the_launcher_policy(self):
        for env in ({'PATRONI_CONFIGURATION': 'watchdog: {mode: off}'},
                    {'PATRONI_SCOPE': 'other-cluster'},
                    {'PATRONI_WATCHDOG_MODE': 'off'}):
            with self.assertRaises(ValueError):
                configure_watchdog(copy.deepcopy(self.config), env)

    def test_independent_device_and_safe_budget(self):
        configure_watchdog(self.config, {'HA_WATCHDOG_DEVICE': '/dev/watchdog0'})
        self.assertEqual(self.config['watchdog']['device'], '/dev/watchdog0')
        for ttl in (True, 0, 16):
            config = copy.deepcopy(self.config)
            config['bootstrap']['dcs']['ttl'] = ttl
            with self.assertRaises(ValueError):
                configure_watchdog(config, {})


if __name__ == '__main__':
    unittest.main()

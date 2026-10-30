"""Exercise check-release-env.sh against throwaway env files."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'check-release-env.sh'
GOOD = 'VAT_REGISTERS_ENABLED=true\nCOMPANY_NAME="ParcelMoover Pvt. Ltd."\nCOMPANY_PAN=609000123\nNCM_PAN=301234567\nUPAYA_PAN=302345678\n'


class ReleaseEnvCheckTest(unittest.TestCase):
    def run_check(self, env_text):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        env_file = Path(temp.name) / '.env.production'
        env_file.write_text(env_text)
        return subprocess.run(['bash', str(SCRIPT)], env={'ENV_FILE': str(env_file), 'PATH': '/usr/bin:/bin'},
                              capture_output=True, text=True)

    def test_complete_env_passes(self):
        result = self.run_check(GOOD)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('::warning', result.stdout)

    def test_vat_flag_off_blocks_release(self):
        result = self.run_check(GOOD.replace('VAT_REGISTERS_ENABLED=true', 'VAT_REGISTERS_ENABLED=false'))
        self.assertEqual(result.returncode, 1)
        self.assertIn('VAT_REGISTERS_ENABLED', result.stdout)

    def test_missing_company_details_only_warn(self):
        result = self.run_check('VAT_REGISTERS_ENABLED=true\nCOMPANY_NAME=\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('COMPANY_NAME is not set', result.stdout)
        self.assertIn('COMPANY_PAN is not set', result.stdout)

    def test_malformed_company_pan_blocks_release(self):
        result = self.run_check(GOOD.replace('COMPANY_PAN=609000123', 'COMPANY_PAN=12345'))
        self.assertEqual(result.returncode, 1)
        self.assertIn('9-digit', result.stdout)

    def test_last_assignment_wins(self):
        result = self.run_check(GOOD + 'VAT_REGISTERS_ENABLED=false\n')
        self.assertEqual(result.returncode, 1)

    def test_missing_carrier_pan_only_warns(self):
        result = self.run_check(GOOD.replace('NCM_PAN=301234567\n', ''))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('NCM_PAN', result.stdout)

    def test_unreadable_file_fails(self):
        result = subprocess.run(['bash', str(SCRIPT)], env={'ENV_FILE': '/nonexistent/.env', 'PATH': '/usr/bin:/bin'},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)


if __name__ == '__main__':
    unittest.main()

"""Source validation must run independently of explicitly requested publication."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Workflows(unittest.TestCase):
    def test_source_checks_cover_push_and_pull_requests_without_write_authority(self):
        source = (ROOT / '.github/workflows/checks.yml').read_text()
        self.assertRegex(source, r'on:\s*\[push,\s*pull_request\]')
        self.assertNotIn('paths:', source)
        self.assertIn('contents: read', source)
        self.assertNotIn('contents: write', source)
        self.assertNotIn('GH_TOKEN', source)
        self.assertIn('npm test', source)
        self.assertIn('npm run build', source)
        self.assertNotIn('release.py publish', source)

    def test_publication_requires_manual_dispatch_on_main(self):
        source = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('workflow_dispatch:', source)
        self.assertNotIn('\n  push:', source)
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", source)

    def test_release_prepare_alias_is_offline_preparation_with_an_explicit_output(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['scripts']['release:prepare'], 'python3 scripts/github-release.py prepare --output build/release')


if __name__ == '__main__':
    unittest.main()

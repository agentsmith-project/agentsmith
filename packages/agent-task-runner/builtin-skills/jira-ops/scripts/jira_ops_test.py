import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jira_ops


class JiraOpsTests(unittest.TestCase):
    @patch("jira_ops.resolve_simple_credential_dependency")
    def test_reads_simple_jira_credentials_from_runtime_dependency(self, mock_resolve: MagicMock) -> None:
        mock_resolve.return_value = {
            "base_url": "https://jira.example.com",
            "token": "jira_token_123",
        }

        base_url, token = jira_ops.load_simple_jira_credentials_from_context()

        self.assertEqual(base_url, "https://jira.example.com")
        self.assertEqual(token, "jira_token_123")
        self.assertEqual(mock_resolve.call_args.args[1], "jira-auth")

    @patch("jira_ops.resolve_simple_credential_dependency")
    def test_returns_none_when_runtime_dependency_is_empty(self, mock_resolve: MagicMock) -> None:
        mock_resolve.return_value = {}

        base_url, token = jira_ops.load_simple_jira_credentials_from_context()

        self.assertIsNone(base_url)
        self.assertIsNone(token)


if __name__ == "__main__":
    unittest.main()

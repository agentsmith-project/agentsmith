import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jira_ops


class JiraOpsTests(unittest.TestCase):
    @patch.dict(
        "os.environ",
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    @patch("jira_ops.urllib.request.urlopen")
    def test_reads_simple_jira_credentials_from_context(self, mock_urlopen: MagicMock) -> None:
        responses = [
            {"content": "https://jira.example.com"},
            {"content": "jira_token_123"},
        ]

        def side_effect(_req, timeout=30):  # noqa: ANN001
            payload = responses.pop(0)
            response = MagicMock()
            response.read.return_value = json.dumps(payload).encode("utf-8")
            cm = MagicMock()
            cm.__enter__.return_value = response
            cm.__exit__.return_value = False
            return cm

        mock_urlopen.side_effect = side_effect

        base_url, token = jira_ops.load_simple_jira_credentials_from_context()
        self.assertEqual(base_url, "https://jira.example.com")
        self.assertEqual(token, "jira_token_123")


if __name__ == "__main__":
    unittest.main()

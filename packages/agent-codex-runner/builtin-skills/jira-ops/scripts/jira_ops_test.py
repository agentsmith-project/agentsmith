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
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
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
        first_request = mock_urlopen.call_args_list[0].args[0]
        second_request = mock_urlopen.call_args_list[1].args[0]
        self.assertIn(
            "http://localhost:20000/api/v1/context?scope=task&key=credentials.jira_base_url",
            first_request.full_url,
        )
        self.assertIn(
            "http://localhost:20000/api/v1/context?scope=task&key=credentials.jira_token",
            second_request.full_url,
        )

    @patch.dict(
        "os.environ",
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    @patch("jira_ops.context_api_get")
    def test_prefers_task_context_before_member_context(self, mock_context_api_get: MagicMock) -> None:
        def side_effect(scope: str, key: str) -> str | None:
            mapping = {
                ("task", "credentials.jira_base_url"): "https://task-jira.example.com",
                ("task", "credentials.jira_token"): "task_token",
                ("member", "credentials.jira_base_url"): "https://member-jira.example.com",
                ("member", "credentials.jira_token"): "member_token",
            }
            return mapping.get((scope, key))

        mock_context_api_get.side_effect = side_effect

        base_url, token = jira_ops.load_simple_jira_credentials_from_context()
        self.assertEqual(base_url, "https://task-jira.example.com")
        self.assertEqual(token, "task_token")


if __name__ == "__main__":
    unittest.main()

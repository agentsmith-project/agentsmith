import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import context_cli


class ContextCliTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    def test_build_query_uses_agent_context_defaults(self) -> None:
        args = MagicMock(scope="task", key="notes.current", workspace_id=None, project_id=None, task_id=None)
        self.assertEqual(
            context_cli.build_query(args),
            {
                "scope": "task",
                "key": "notes.current",
                "workspace_id": "ws_default",
                "project_id": "proj_1",
                "task_id": "task_1",
            },
        )

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
        },
        clear=False,
    )
    @patch("context_cli.urlopen")
    def test_refresh_managed_credential_uses_workspace_context(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        payload = context_cli.api_request(
            "POST",
            "/api/v1/context/managed-credentials/feishu/refresh",
            query={"workspace_id": "ws_default"},
        )

        self.assertEqual(payload, {"ok": True})
        req = mock_urlopen.call_args.args[0]
        self.assertIn("workspace_id=ws_default", req.full_url)
        self.assertEqual(req.headers["Authorization"], "Bearer ticket_123")


if __name__ == "__main__":
    unittest.main()

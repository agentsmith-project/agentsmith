import json
import os
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".mbos-runtime"))
import context_cli
import capability_runtime


class ContextCliTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
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
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    def test_build_query_uses_project_member_scope_contract(self) -> None:
        args = MagicMock(scope="project_member", key="bindings.feishu.connection_id", workspace_id=None, project_id=None, task_id=None)
        self.assertEqual(
            context_cli.build_query(args),
            {
                "scope": "project_member",
                "key": "bindings.feishu.connection_id",
                "workspace_id": "ws_default",
                "project_id": "proj_1",
            },
        )

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    def test_build_query_keeps_project_context_for_member_managed_credential_projection(self) -> None:
        args = MagicMock(scope="member", key="managed_credentials.feishu", workspace_id=None, project_id=None, task_id=None)
        self.assertEqual(
            context_cli.build_query(args),
            {
                "scope": "member",
                "key": "managed_credentials.feishu",
                "workspace_id": "ws_default",
                "project_id": "proj_1",
            },
        )

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
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
            "/context/managed-credentials/feishu/refresh",
            query={"workspace_id": "ws_default"},
        )

        self.assertEqual(payload, {"ok": True})
        req = mock_urlopen.call_args.args[0]
        self.assertEqual(
            req.full_url,
            "http://localhost:20000/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default",
        )
        self.assertEqual(req.headers["Authorization"], "Bearer ticket_123")

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
        },
        clear=False,
    )
    @patch("context_cli.urlopen")
    def test_refresh_managed_credential_accepts_explicit_project_id(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        with patch.object(
            sys,
            "argv",
            [
                "context_cli.py",
                "refresh-managed-credential",
                "--provider",
                "feishu",
                "--workspace-id",
                "ws_default",
                "--project-id",
                "proj_1",
            ],
        ), patch("sys.stdout", new_callable=StringIO):
            exit_code = context_cli.main()

        self.assertEqual(exit_code, 0)
        req = mock_urlopen.call_args.args[0]
        self.assertEqual(
            req.full_url,
            "http://localhost:20000/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default&project_id=proj_1",
        )

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_env",
        },
        clear=False,
    )
    @patch("context_cli.urlopen")
    def test_refresh_managed_credential_uses_env_project_context(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        with patch.object(
            sys,
            "argv",
            [
                "context_cli.py",
                "refresh-managed-credential",
                "--provider",
                "feishu",
            ],
        ), patch("sys.stdout", new_callable=StringIO):
            exit_code = context_cli.main()

        self.assertEqual(exit_code, 0)
        req = mock_urlopen.call_args.args[0]
        self.assertEqual(
            req.full_url,
            "http://localhost:20000/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_default&project_id=proj_env",
        )

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    @patch("capability_runtime.urlopen")
    def test_resolves_simple_credential_dependency_from_skill_contract(self, mock_urlopen: MagicMock) -> None:
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

        resolved = capability_runtime.resolve_simple_credential_dependency(
            Path(__file__).resolve().parents[2] / "jira-ops" / "scripts" / "jira_ops.py",
            "jira-auth",
        )

        self.assertEqual(
            resolved,
            {
                "base_url": "https://jira.example.com",
                "token": "jira_token_123",
            },
        )
        first_request = mock_urlopen.call_args_list[0].args[0]
        second_request = mock_urlopen.call_args_list[1].args[0]
        self.assertIn("scope=task&key=credentials.jira_base_url", first_request.full_url)
        self.assertIn("scope=task&key=credentials.jira_token", second_request.full_url)

    @patch.dict(
        os.environ,
        {
            "MBOS_AGENT_API_BASE": "http://localhost:20000/api/v1",
            "MBOS_AGENT_EXECUTION_TICKET": "ticket_123",
            "MBOS_AGENT_WORKSPACE_ID": "ws_default",
            "MBOS_AGENT_PROJECT_ID": "proj_1",
            "MBOS_AGENT_TASK_ID": "task_1",
        },
        clear=False,
    )
    def test_runtime_helper_keeps_project_context_for_member_managed_projection(self) -> None:
        client = capability_runtime.ContextStoreClient(api_base="http://localhost:20000/api/v1", execution_ticket="ticket_123")
        self.assertEqual(
            client.build_query(scope="member", key="managed_credentials.feishu"),
            {
                "scope": "member",
                "key": "managed_credentials.feishu",
                "workspace_id": "ws_default",
                "project_id": "proj_1",
            },
        )


if __name__ == "__main__":
    unittest.main()

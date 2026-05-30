import json
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
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
        args = MagicMock(scope="project_member", key="bindings.sample_provider.connection_id", workspace_id=None, project_id=None, task_id=None)
        self.assertEqual(
            context_cli.build_query(args),
            {
                "scope": "project_member",
                "key": "bindings.sample_provider.connection_id",
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
        args = MagicMock(scope="member", key="managed_credentials.sample_provider", workspace_id=None, project_id=None, task_id=None)
        self.assertEqual(
            context_cli.build_query(args),
            {
                "scope": "member",
                "key": "managed_credentials.sample_provider",
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
    @patch("capability_runtime.urlopen")
    def test_resolves_simple_credential_dependency_from_skill_contract(self, mock_urlopen: MagicMock) -> None:
        responses = [
            {"content": "https://service.example.com"},
            {"content": "sample_token_123"},
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

        with TemporaryDirectory() as temp_dir:
            skill_root = Path(temp_dir) / "sample-tool"
            script_path = skill_root / "scripts" / "sample_tool.py"
            script_path.parent.mkdir(parents=True)
            script_path.write_text("", encoding="utf-8")
            (skill_root / "capabilities.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "skill_name": "sample-tool",
                        "dependencies": [
                            {
                                "name": "sample-secret",
                                "kind": "simple_credential_bundle",
                                "scopes": ["task", "member"],
                                "fields": [
                                    {
                                        "name": "base_url",
                                        "keys": ["credentials.sample_base_url"],
                                        "required": True,
                                    },
                                    {
                                        "name": "token",
                                        "keys": ["credentials.sample_token"],
                                        "required": True,
                                    },
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            resolved = capability_runtime.resolve_simple_credential_dependency(
                script_path,
                "sample-secret",
            )

        self.assertEqual(
            resolved,
            {
                "base_url": "https://service.example.com",
                "token": "sample_token_123",
            },
        )
        first_request = mock_urlopen.call_args_list[0].args[0]
        second_request = mock_urlopen.call_args_list[1].args[0]
        self.assertIn("scope=task&key=credentials.sample_base_url", first_request.full_url)
        self.assertIn("scope=task&key=credentials.sample_token", second_request.full_url)

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
            client.build_query(scope="member", key="managed_credentials.sample_provider"),
            {
                "scope": "member",
                "key": "managed_credentials.sample_provider",
                "workspace_id": "ws_default",
                "project_id": "proj_1",
            },
        )


if __name__ == "__main__":
    unittest.main()

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feishu_mcp


def write_connections_file(root: Path, payload: dict) -> Path:
    feishu_dir = root / "feishu"
    feishu_dir.mkdir(parents=True, exist_ok=True)
    target = feishu_dir / "connections.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return feishu_dir


class FeishuMcpTests(unittest.TestCase):
    @patch("feishu_mcp.resolve_managed_credential_dependency")
    def test_loads_managed_connection_from_runtime_dependency(self, mock_resolve: MagicMock) -> None:
        mock_resolve.return_value = {
            "provider": "feishu",
            "fields": {"access_token": "token_from_runtime"},
        }

        connection = feishu_mcp.load_managed_connection_from_context()

        self.assertEqual(connection["fields"]["access_token"], "token_from_runtime")
        self.assertEqual(mock_resolve.call_args.args[1], "feishu-managed-user")

    @patch("feishu_mcp.refresh_managed_credential_dependency")
    def test_refreshes_managed_connection_from_runtime_dependency(self, mock_refresh: MagicMock) -> None:
        mock_refresh.return_value = {
            "provider": "feishu",
            "fields": {"access_token": "token_refreshed"},
        }

        connection = feishu_mcp.refresh_managed_connection_from_context()

        self.assertEqual(connection["fields"]["access_token"], "token_refreshed")
        self.assertEqual(mock_refresh.call_args.args[1], "feishu-managed-user")

    def test_uses_single_active_connection_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            credential_dir = write_connections_file(
                Path(tmp),
                {
                    "provider": "feishu",
                    "connections": [
                        {
                            "connection_id": "conn_target",
                            "status": "active",
                            "workspace_id": "ws_target",
                            "fields": {
                                "access_token": "token_target",
                                "refresh_token": "refresh_target",
                                "app_id": "cli_target",
                                "app_secret": "secret_target",
                            },
                        }
                    ],
                },
            )
            self.assertEqual(feishu_mcp.get_access_token(credential_dir), "token_target")
            _path, _payload, connection = feishu_mcp.load_active_connection(credential_dir)
            self.assertEqual(feishu_mcp.get_connection_field(connection, "app_id"), "cli_target")
            self.assertEqual(feishu_mcp.get_connection_field(connection, "app_secret"), "secret_target")
            self.assertEqual(feishu_mcp.find_credential_dir(credential_dir), credential_dir)

    def test_rejects_multiple_active_connections(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            credential_dir = write_connections_file(
                Path(tmp),
                {
                    "provider": "feishu",
                    "connections": [
                        {
                            "connection_id": "conn_a",
                            "status": "active",
                            "fields": {"access_token": "a"},
                        },
                        {
                            "connection_id": "conn_b",
                            "status": "active",
                            "fields": {"access_token": "b"},
                        },
                    ],
                },
            )
            with self.assertRaisesRegex(RuntimeError, "Multiple active Feishu connections found"):
                feishu_mcp.load_active_connection(credential_dir)

    @patch("feishu_mcp.urlopen")
    def test_refresh_updates_only_selected_connection(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "access_token": "token_new",
                "refresh_token": "refresh_new",
                "expires_in": 3600,
            }
        ).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        with tempfile.TemporaryDirectory() as tmp:
            credential_dir = write_connections_file(
                Path(tmp),
                {
                    "provider": "feishu",
                    "connections": [
                        {
                            "connection_id": "conn_target",
                            "status": "active",
                            "fields": {
                                "access_token": "token_old",
                                "refresh_token": "refresh_old",
                                "app_id": "cli_target",
                                "app_secret": "secret_target",
                            },
                        },
                        {
                            "connection_id": "conn_inactive",
                            "status": "reauth_required",
                            "fields": {
                                "access_token": "token_other",
                                "refresh_token": "refresh_other",
                                "app_id": "cli_other",
                                "app_secret": "secret_other",
                            },
                        },
                    ],
                },
            )

            refreshed = feishu_mcp.refresh_token(credential_dir)
            self.assertEqual(refreshed["access_token"], "token_new")
            payload = json.loads((credential_dir / "connections.json").read_text(encoding="utf-8"))
            target = next(item for item in payload["connections"] if item["connection_id"] == "conn_target")
            other = next(item for item in payload["connections"] if item["connection_id"] == "conn_inactive")
            self.assertEqual(target["fields"]["access_token"], "token_new")
            self.assertEqual(target["fields"]["refresh_token"], "refresh_new")
            self.assertEqual(other["fields"]["access_token"], "token_other")
            self.assertEqual(other["fields"]["refresh_token"], "refresh_other")


if __name__ == "__main__":
    unittest.main()

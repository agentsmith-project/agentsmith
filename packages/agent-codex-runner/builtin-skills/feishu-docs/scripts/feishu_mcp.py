#!/usr/bin/env python3
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ENDPOINT = "https://mcp.feishu.cn/mcp"
DEFAULT_ALLOWED_TOOLS = (
    "search-user,get-user,fetch-file,search-doc,create-doc,"
    "fetch-doc,update-doc,list-docs,get-comments,add-comments"
)
OAUTH_TOKEN_ENDPOINT = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
MANAGED_CONTEXT_KEY = "managed_credentials.feishu"


def read_api_base() -> str | None:
    value = os.environ.get("MBOS_AGENT_API_BASE", "").strip()
    return value.rstrip("/") if value else None


def read_execution_ticket() -> str | None:
    value = os.environ.get("MBOS_AGENT_EXECUTION_TICKET", "").strip()
    return value or None


def build_context_query(*, scope: str, key: str) -> str:
    query: dict[str, str] = {"scope": scope, "key": key}
    workspace_id = os.environ.get("MBOS_AGENT_WORKSPACE_ID", "").strip()
    project_id = os.environ.get("MBOS_AGENT_PROJECT_ID", "").strip()
    task_id = os.environ.get("MBOS_AGENT_TASK_ID", "").strip()
    if workspace_id:
        query["workspace_id"] = workspace_id
    if project_id:
        query["project_id"] = project_id
    if task_id:
        query["task_id"] = task_id
    return urlencode(query)


def context_api_request(method: str, path: str) -> dict[str, Any]:
    api_base = read_api_base()
    ticket = read_execution_ticket()
    if not api_base or not ticket:
        raise RuntimeError("Context API is unavailable in this runner session.")

    req = Request(
        f"{api_base}{path}",
        headers={"Authorization": f"Bearer {ticket}"},
        method=method,
    )
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Context API HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Context API network error: {exc}") from exc

    if not raw.strip():
        return {}
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("Context API returned an unexpected payload.")
    return payload


def load_managed_connection_from_context() -> dict[str, Any] | None:
    if not read_api_base() or not read_execution_ticket():
        raise RuntimeError(
            "Managed Feishu credentials are unavailable. This skill requires AgentSmith Context Store access in notebook or terminal runner sessions."
        )
    payload = context_api_request(
        "GET",
        f"/api/v1/context?{build_context_query(scope='user', key=MANAGED_CONTEXT_KEY)}",
    )
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Managed Feishu credential projection is empty.")
    projected = json.loads(content)
    if not isinstance(projected, dict):
        raise RuntimeError("Managed Feishu credential projection is invalid.")
    return projected


def refresh_managed_connection_from_context() -> dict[str, Any]:
    if not read_api_base() or not read_execution_ticket():
        raise RuntimeError("Context API is unavailable in this runner session.")
    workspace_id = os.environ.get("MBOS_AGENT_WORKSPACE_ID", "").strip()
    search = f"?workspace_id={workspace_id}" if workspace_id else ""
    payload = context_api_request(
        "POST",
        f"/api/v1/context/managed-credentials/feishu/refresh{search}",
    )
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Managed Feishu credential refresh returned empty content.")
    projected = json.loads(content)
    if not isinstance(projected, dict):
        raise RuntimeError("Managed Feishu credential refresh returned invalid content.")
    return projected


def resolve_explicit_credential_dir(candidate: Path, anchor: Path | None = None) -> Path | None:
    path = candidate.expanduser()
    if not path.is_absolute():
        path = ((anchor or Path.cwd()).resolve() / path).resolve()
    else:
        path = path.resolve()
    if not path.is_dir():
        return None
    feishu_subdir = path / "feishu"
    if feishu_subdir.is_dir():
        return feishu_subdir
    return path


def find_credential_dir(start: Path | None = None) -> Path:
    configured = os.environ.get("MBOS_TASK_CREDENTIAL_DIR", "").strip()
    if configured:
        resolved = resolve_explicit_credential_dir(Path(configured), start)
        if resolved is not None:
            return resolved

    if start is not None:
        resolved = resolve_explicit_credential_dir(start)
        if resolved is not None:
            return resolved

    current = Path.cwd().resolve()
    for base in [current, *current.parents]:
        for root in (base / ".mbos" / "credentials", base / ".codex" / "credential"):
            if not root.is_dir():
                continue
            feishu_subdir = root / "feishu"
            if feishu_subdir.is_dir():
                return feishu_subdir
            return root
    raise FileNotFoundError("Could not find .mbos/credentials or .codex/credential in the current directory or its parents.")


def load_connections_document(credential_dir: Path) -> tuple[Path, dict[str, Any]]:
    path = credential_dir / "connections.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"Feishu credential file not found at {path}. "
            "AgentSmith should generate .mbos/credentials/feishu/connections.json."
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Feishu credential file is invalid: expected top-level object.")
    if payload.get("provider") != "feishu":
        raise RuntimeError("Feishu credential file is invalid: provider must be 'feishu'.")
    connections = payload.get("connections")
    if not isinstance(connections, list):
        raise RuntimeError("Feishu credential file is invalid: connections must be a list.")
    return path, payload


def normalize_connection(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    connection_id = raw.get("connection_id")
    status = raw.get("status")
    fields = raw.get("fields")
    if not isinstance(connection_id, str) or not connection_id.strip():
        return None
    if not isinstance(status, str) or not status.strip():
        return None
    if not isinstance(fields, dict):
        return None
    normalized_fields: dict[str, str] = {}
    for key, value in fields.items():
        if isinstance(key, str) and isinstance(value, str) and value.strip():
            normalized_fields[key] = value.strip()
    return {
        "connection_id": connection_id.strip(),
        "status": status.strip(),
        "workspace_id": raw.get("workspace_id") if isinstance(raw.get("workspace_id"), str) else None,
        "display_name": raw.get("display_name") if isinstance(raw.get("display_name"), str) else None,
        "fields": normalized_fields,
    }


def load_active_connection(credential_dir: Path) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    path, payload = load_connections_document(credential_dir)
    normalized = [
        item
        for item in (normalize_connection(raw) for raw in payload.get("connections", []))
        if item is not None
    ]
    active = [item for item in normalized if item["status"] == "active"]
    if not active:
        raise RuntimeError("No active Feishu connection found in connections.json.")
    if len(active) > 1:
        ids = ", ".join(item["connection_id"] for item in active)
        raise RuntimeError(
            f"Multiple active Feishu connections found ({ids}). "
            "AgentSmith runner requires a single active Feishu connection per task."
        )
    return path, payload, active[0]


def get_connection_field(connection: dict[str, Any], *keys: str) -> str | None:
    fields = connection.get("fields", {})
    if not isinstance(fields, dict):
        return None
    for key in keys:
        value = fields.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_projected_connection_field(connection: dict[str, Any], *keys: str) -> str | None:
    fields = connection.get("fields")
    if not isinstance(fields, dict):
        return None
    for key in keys:
        value = fields.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def resolve_managed_connection() -> dict[str, Any]:
    managed = load_managed_connection_from_context()
    if managed is None:
        raise RuntimeError("Managed Feishu credentials are unavailable.")
    return managed


def get_access_token(credential_dir: Path) -> str:
    _path, _payload, connection = load_active_connection(credential_dir)
    token = get_connection_field(connection, "access_token", "uat", "token")
    if token:
        return token
    raise RuntimeError("Active Feishu connection is missing access_token.")


def get_mcp_endpoint(connection: dict[str, Any]) -> str:
    return (
        os.environ.get("FEISHU_MCP_ENDPOINT", "").strip()
        or get_connection_field(connection, "feishu_mcp_endpoint")
        or ENDPOINT
    )


def get_oauth_token_endpoint(connection: dict[str, Any]) -> str:
    return (
        os.environ.get("FEISHU_OAUTH_TOKEN_ENDPOINT", "").strip()
        or os.environ.get("FEISHU_OAUTH_TOKEN_URL", "").strip()
        or get_connection_field(connection, "feishu_oauth_token_endpoint")
        or OAUTH_TOKEN_ENDPOINT
    )


def build_headers(allowed_tools: str) -> dict[str, str]:
    connection = resolve_managed_connection()
    token = get_projected_connection_field(connection, "access_token", "uat", "token")
    if not token:
        raise RuntimeError("Active Feishu connection is missing access_token.")

    return {
        "Content-Type": "application/json",
        "X-Lark-MCP-UAT": token,
        "X-Lark-MCP-Allowed-Tools": allowed_tools,
    }


def rpc_call(method: str, params: dict, allowed_tools: str) -> dict:
    connection = resolve_managed_connection()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        (
            os.environ.get("FEISHU_MCP_ENDPOINT", "").strip()
            or get_projected_connection_field(connection, "feishu_mcp_endpoint")
            or ENDPOINT
        ),
        data=data,
        headers=build_headers(allowed_tools),
        method="POST",
    )

    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"HTTP {exc.code} from Feishu MCP: {body}\n"
            "If this looks like token expiry, run this script with `refresh-token`."
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Network error calling Feishu MCP: {exc}") from exc

    result = json.loads(body)
    if result.get("error"):
        raise RuntimeError(
            "Feishu MCP returned error: "
            + json.dumps(result["error"], ensure_ascii=False)
            + "\nIf this looks like auth expiry, run this script with `refresh-token`."
        )
    return result


def parse_json_arg(raw: str | None) -> dict:
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("JSON params must decode to an object")
    return parsed


def save_refreshed_token(
    target: Path,
    current: dict[str, Any],
    connection_id: str,
    refreshed: dict[str, Any],
) -> Path:
    connections = current.get("connections")
    if not isinstance(connections, list):
        raise RuntimeError("Feishu credential file is invalid: connections must be a list.")
    updated = False
    for item in connections:
        if not isinstance(item, dict) or item.get("connection_id") != connection_id:
            continue
        fields = item.get("fields")
        if not isinstance(fields, dict):
            fields = {}
            item["fields"] = fields
        if isinstance(refreshed.get("access_token"), str) and refreshed["access_token"].strip():
            fields["access_token"] = refreshed["access_token"].strip()
        if isinstance(refreshed.get("refresh_token"), str) and refreshed["refresh_token"].strip():
            fields["refresh_token"] = refreshed["refresh_token"].strip()
        expires_in = refreshed.get("expires_in")
        if isinstance(expires_in, int) and expires_in > 0:
            item["expires_at"] = (
                datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            ).isoformat().replace("+00:00", "Z")
        item["last_refreshed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        item["status"] = "active"
        updated = True
        break
    if not updated:
        raise RuntimeError(f"Active Feishu connection {connection_id} not found in connections.json.")
    target.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def refresh_token(credential_dir: Path) -> dict:
    target, document, connection = load_active_connection(credential_dir)

    refresh_value = get_connection_field(connection, "refresh_token")
    app_id = get_connection_field(connection, "app_id", "client_id")
    app_secret = get_connection_field(connection, "app_secret", "client_secret")

    if not refresh_value:
        raise RuntimeError("Active Feishu connection is missing refresh_token.")
    if not app_id or not app_secret:
        raise RuntimeError("Active Feishu connection is missing app_id/app_secret.")

    request_payload = {
        "grant_type": "refresh_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "refresh_token": refresh_value,
    }
    data = json.dumps(request_payload).encode("utf-8")
    req = Request(
        get_oauth_token_endpoint(connection),
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} while refreshing Feishu token: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error refreshing Feishu token: {exc}") from exc

    refreshed = json.loads(body)
    if refreshed.get("code") not in (None, 0) or not refreshed.get("access_token"):
        raise RuntimeError(
            "Feishu token refresh failed: " + json.dumps(refreshed, ensure_ascii=False)
        )

    saved_path = save_refreshed_token(target, document, connection["connection_id"], refreshed)
    output = dict(refreshed)
    output["_saved_path"] = str(saved_path)
    return output


def cmd_initialize(args: argparse.Namespace) -> int:
    result = rpc_call(
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "feishu-docs-skill", "version": "1.0.0"},
        },
        args.allowed_tools,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_tools_list(args: argparse.Namespace) -> int:
    result = rpc_call("tools/list", {}, args.allowed_tools)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_call_tool(args: argparse.Namespace) -> int:
    tool_name = args.tool_name
    params = parse_json_arg(args.params)
    allowed_tools = args.allowed_tools or tool_name
    result = rpc_call(
        "tools/call",
        {
            "name": tool_name,
            "arguments": params,
        },
        allowed_tools,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_refresh_token(args: argparse.Namespace) -> int:
    refreshed = refresh_managed_connection_from_context()
    summary = {
        "provider": refreshed.get("provider"),
        "status": refreshed.get("status"),
        "expires_at": refreshed.get("expires_at"),
        "scopes": refreshed.get("scopes"),
        "mode": "managed_context",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call Feishu remote MCP over HTTP using AgentSmith-managed credentials from Context Store."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("initialize")
    init_parser.add_argument("--allowed-tools", default=DEFAULT_ALLOWED_TOOLS)
    init_parser.set_defaults(func=cmd_initialize)

    list_parser = subparsers.add_parser("tools-list")
    list_parser.add_argument("--allowed-tools", default=DEFAULT_ALLOWED_TOOLS)
    list_parser.set_defaults(func=cmd_tools_list)

    call_parser = subparsers.add_parser("call-tool")
    call_parser.add_argument("tool_name")
    call_parser.add_argument("--params", default="{}")
    call_parser.add_argument(
        "--allowed-tools",
        default=None,
        help="Comma-separated whitelist sent to Feishu. Defaults to the tool name being called.",
    )
    call_parser.set_defaults(func=cmd_call_tool)

    refresh_parser = subparsers.add_parser("refresh-token")
    refresh_parser.set_defaults(func=cmd_refresh_token)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ENDPOINT = "https://mcp.feishu.cn/mcp"
DEFAULT_ALLOWED_TOOLS = (
    "search-user,get-user,fetch-file,search-doc,create-doc,"
    "fetch-doc,update-doc,list-docs,get-comments,add-comments"
)
OAUTH_TOKEN_ENDPOINT = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"


def load_env_like_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def find_credential_dir(start: Path | None = None) -> Path:
    configured = os.environ.get("MBOS_TASK_CREDENTIAL_DIR", "").strip()
    if configured:
        configured_path = Path(configured).expanduser()
        if not configured_path.is_absolute():
            configured_path = (start or Path.cwd()).resolve() / configured_path
        configured_path = configured_path.resolve()
        if configured_path.is_dir():
            feishu_subdir = configured_path / "feishu"
            if feishu_subdir.is_dir():
                return feishu_subdir
            return configured_path

    current = (start or Path.cwd()).resolve()
    for base in [current, *current.parents]:
        root = base / ".codex" / "credential"
        if not root.is_dir():
            continue
        feishu_subdir = root / "feishu"
        if feishu_subdir.is_dir():
            return feishu_subdir
        return root
    raise FileNotFoundError(
        "Could not find .codex/credential in the current directory or its parents."
    )


def flatten_json(prefix: str, value):
    if isinstance(value, dict):
        for key, inner in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            yield from flatten_json(next_prefix, inner)
    elif isinstance(value, list):
        for idx, inner in enumerate(value):
            next_prefix = f"{prefix}[{idx}]"
            yield from flatten_json(next_prefix, inner)
    else:
        yield prefix, value


def discover_credentials(credential_dir: Path) -> dict:
    discovered = {
        "access_token_candidates": [],
        "refresh_token_candidates": [],
        "app_id_candidates": [],
        "app_secret_candidates": [],
        "token_object_path": None,
        "token_object_payload": None,
    }

    plain_kv_pattern = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.+?)\s*$")

    def classify_pair(key: str, value: str) -> None:
        key_lower = key.lower()
        value_strip = value.strip().strip("'").strip('"')
        if not value_strip:
            return

        if "refresh" in key_lower and "token" in key_lower:
            discovered["refresh_token_candidates"].append(value_strip)
            return
        if ("access" in key_lower and "token" in key_lower) or "uat" in key_lower:
            discovered["access_token_candidates"].append(value_strip)
            return
        if "token" in key_lower:
            discovered["access_token_candidates"].append(value_strip)
            return
        if ("app" in key_lower and "secret" in key_lower) or (
            "client" in key_lower and "secret" in key_lower
        ):
            discovered["app_secret_candidates"].append(value_strip)
            return
        if ("app" in key_lower and key_lower.endswith("id")) or (
            "client" in key_lower and key_lower.endswith("id")
        ):
            discovered["app_id_candidates"].append(value_strip)

    for path in sorted(p for p in credential_dir.rglob("*") if p.is_file()):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None

        if isinstance(parsed, dict):
            for key, value in flatten_json("", parsed):
                if isinstance(value, str):
                    classify_pair(key, value)
            flat_keys = {k.lower() for k, _ in flatten_json("", parsed)}
            if discovered["token_object_path"] is None and (
                "access_token" in flat_keys or "refresh_token" in flat_keys
            ):
                discovered["token_object_path"] = path
                discovered["token_object_payload"] = parsed

        for key, value in load_env_like_text(text).items():
            classify_pair(key, value)

        for line in text.splitlines():
            match = plain_kv_pattern.match(line)
            if not match:
                continue
            classify_pair(match.group(1), match.group(2))

    for name in (
        "access_token_candidates",
        "refresh_token_candidates",
        "app_id_candidates",
        "app_secret_candidates",
    ):
        unique = []
        seen = set()
        for item in discovered[name]:
            if item not in seen:
                unique.append(item)
                seen.add(item)
        discovered[name] = unique

    return discovered


def choose_candidate(candidates: list[str], must_include: list[str] | None = None) -> str | None:
    if not candidates:
        return None
    if not must_include:
        return candidates[0]
    for candidate in candidates:
        lowered = candidate.lower()
        if all(part in lowered for part in must_include):
            return candidate
    return candidates[0]


def get_access_token(credential_dir: Path) -> str:
    discovered = discover_credentials(credential_dir)
    token = choose_candidate(discovered["access_token_candidates"])
    if token:
        return token
    raise RuntimeError(
        "Feishu access token not found under .codex/credential. "
        "Inspect the files and add a self-describing token field (for example access_token or uat)."
    )


def build_headers(credential_dir: Path, allowed_tools: str) -> dict[str, str]:
    token = get_access_token(credential_dir)

    return {
        "Content-Type": "application/json",
        "X-Lark-MCP-UAT": token,
        "X-Lark-MCP-Allowed-Tools": allowed_tools,
    }


def rpc_call(method: str, params: dict, allowed_tools: str, credential_dir: Path) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        ENDPOINT,
        data=data,
        headers=build_headers(credential_dir, allowed_tools),
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


def save_refreshed_token(credential_dir: Path, discovered: dict, payload: dict) -> Path:
    target = discovered.get("token_object_path")
    current = discovered.get("token_object_payload")
    if isinstance(target, Path) and isinstance(current, dict):
        merged = dict(current)
        merged.update(payload)
        target.write_text(
            json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return target

    fallback = credential_dir / "feishu_tokens.generated.json"
    fallback.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return fallback


def refresh_token(credential_dir: Path) -> dict:
    discovered = discover_credentials(credential_dir)

    refresh_value = choose_candidate(discovered["refresh_token_candidates"])
    app_id = choose_candidate(discovered["app_id_candidates"])
    app_secret = choose_candidate(discovered["app_secret_candidates"])

    if not refresh_value:
        raise RuntimeError(
            "Feishu refresh token not found under .codex/credential. "
            "Add a self-describing refresh token field and retry."
        )
    if not app_id or not app_secret:
        raise RuntimeError(
            "Feishu app id/secret not found under .codex/credential. "
            "Add self-describing fields (for example FEISHU_APP_ID and FEISHU_APP_SECRET) and retry."
        )

    payload = {
        "grant_type": "refresh_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "refresh_token": refresh_value,
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        OAUTH_TOKEN_ENDPOINT,
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

    saved_path = save_refreshed_token(credential_dir, discovered, refreshed)
    output = dict(refreshed)
    output["_saved_path"] = str(saved_path)
    return output


def cmd_initialize(args: argparse.Namespace) -> int:
    credential_dir = find_credential_dir(args.credential_dir)
    result = rpc_call(
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "feishu-docs-skill", "version": "1.0.0"},
        },
        args.allowed_tools,
        credential_dir,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_tools_list(args: argparse.Namespace) -> int:
    credential_dir = find_credential_dir(args.credential_dir)
    result = rpc_call("tools/list", {}, args.allowed_tools, credential_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_call_tool(args: argparse.Namespace) -> int:
    credential_dir = find_credential_dir(args.credential_dir)
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
        credential_dir,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_refresh_token(args: argparse.Namespace) -> int:
    credential_dir = find_credential_dir(args.credential_dir)
    refreshed = refresh_token(credential_dir)
    summary = {
        "token_type": refreshed.get("token_type"),
        "expires_in": refreshed.get("expires_in"),
        "refresh_token_expires_in": refreshed.get("refresh_token_expires_in"),
        "scope": refreshed.get("scope"),
        "credential_dir": str(credential_dir),
        "saved_path": refreshed.get("_saved_path"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def add_credential_dir_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--credential-dir",
        type=Path,
        default=None,
        help="Optional path to credential files (for example .codex/credential or .codex/credential/feishu). Defaults to searching from the current directory upward.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call Feishu remote MCP over HTTP using credentials from the current workspace."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("initialize")
    add_credential_dir_arg(init_parser)
    init_parser.add_argument("--allowed-tools", default=DEFAULT_ALLOWED_TOOLS)
    init_parser.set_defaults(func=cmd_initialize)

    list_parser = subparsers.add_parser("tools-list")
    add_credential_dir_arg(list_parser)
    list_parser.add_argument("--allowed-tools", default=DEFAULT_ALLOWED_TOOLS)
    list_parser.set_defaults(func=cmd_tools_list)

    call_parser = subparsers.add_parser("call-tool")
    add_credential_dir_arg(call_parser)
    call_parser.add_argument("tool_name")
    call_parser.add_argument("--params", default="{}")
    call_parser.add_argument(
        "--allowed-tools",
        default=None,
        help="Comma-separated whitelist sent to Feishu. Defaults to the tool name being called.",
    )
    call_parser.set_defaults(func=cmd_call_tool)

    refresh_parser = subparsers.add_parser("refresh-token")
    add_credential_dir_arg(refresh_parser)
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

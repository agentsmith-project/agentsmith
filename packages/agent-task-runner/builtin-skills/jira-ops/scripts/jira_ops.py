#!/usr/bin/env python3
import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SHARED_RUNTIME_DIR = Path(__file__).resolve().parents[2] / ".mbos-runtime"
if str(SHARED_RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_RUNTIME_DIR))

from capability_runtime import resolve_simple_credential_dependency


PROXY_ENV_VARS = [
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
    "no_proxy",
    "NO_PROXY",
]

def load_simple_jira_credentials_from_context() -> tuple[str | None, str | None]:
    resolved = resolve_simple_credential_dependency(__file__, "jira-auth")
    base_url = resolved.get("base_url")
    token = resolved.get("token")
    return (
        base_url.strip() if isinstance(base_url, str) and base_url.strip() else None,
        token.strip() if isinstance(token, str) and token.strip() else None,
    )


def clear_proxy_env() -> None:
    for key in PROXY_ENV_VARS:
        os.environ.pop(key, None)


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
        jira_path = configured_path / "jira"
        if jira_path.is_dir():
            return jira_path

    current = (start or Path.cwd()).resolve()
    for base in [current, *current.parents]:
        for candidate in (
            base / ".mbos" / "credentials" / "jira",
            base / ".codex" / "credential" / "jira",
        ):
            if candidate.is_dir():
                return candidate
    raise FileNotFoundError(
        "Could not find .mbos/credentials/jira or .codex/credential/jira in the current directory or its parents."
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


def discover_credentials(credential_dir: Path) -> dict[str, list[str]]:
    discovered = {"token_candidates": [], "base_url_candidates": []}
    for path in sorted(p for p in credential_dir.rglob("*") if p.is_file()):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        # JSON-like files
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None

        if parsed is not None:
            for key, value in flatten_json("", parsed):
                if not isinstance(value, str):
                    continue
                key_lower = key.lower()
                value_strip = value.strip()
                if "token" in key_lower and value_strip:
                    discovered["token_candidates"].append(value_strip)
                if "url" in key_lower and value_strip.startswith(("http://", "https://")):
                    discovered["base_url_candidates"].append(value_strip)

        # env-like or plain text files
        for key, value in load_env_like_text(text).items():
            key_lower = key.lower()
            value_strip = value.strip()
            if "token" in key_lower and value_strip:
                discovered["token_candidates"].append(value_strip)
            if "url" in key_lower and value_strip.startswith(("http://", "https://")):
                discovered["base_url_candidates"].append(value_strip)

        # last-resort plain text URL scan
        for line in text.splitlines():
            line = line.strip()
            if line.startswith(("http://", "https://")):
                discovered["base_url_candidates"].append(line)

    # preserve order, remove duplicates
    for name in discovered:
        unique = []
        seen = set()
        for item in discovered[name]:
            if item not in seen:
                unique.append(item)
                seen.add(item)
        discovered[name] = unique
    return discovered


def resolve_auth(args) -> tuple[str, str]:
    if args.base_url and args.token:
        return args.base_url, args.token

    context_base_url, context_token = load_simple_jira_credentials_from_context()
    base_url = args.base_url or context_base_url
    token = args.token or context_token
    if base_url and token:
        return base_url, token

    if not base_url:
        raise RuntimeError(
            "Jira base URL not found. Configure the 'jira-auth' runtime credential bundle in AgentSmith or pass --base-url."
        )
    if not token:
        raise RuntimeError(
            "Jira token not found. Configure the 'jira-auth' runtime credential bundle in AgentSmith or pass --token."
        )
    return base_url, token


def request_json(base_url: str, token: str, method: str, path: str, params=None, body=None):
    clear_proxy_env()
    url = base_url.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)

    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {method} {path}: {detail}") from exc
    if not raw:
        return {}
    return json.loads(raw)


def cmd_myself(args):
    base_url, token = resolve_auth(args)
    result = request_json(base_url, token, "GET", "/rest/api/2/myself")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_search(args):
    base_url, token = resolve_auth(args)
    fields = [item.strip() for item in args.fields.split(",")] if args.fields else []
    if args.use_post or len(args.jql) > 1200:
        body = {
            "jql": args.jql,
            "maxResults": args.max_results,
            "fields": fields,
        }
        result = request_json(base_url, token, "POST", "/rest/api/2/search", body=body)
    else:
        params = {
            "jql": args.jql,
            "maxResults": args.max_results,
            "fields": args.fields,
        }
        result = request_json(base_url, token, "GET", "/rest/api/2/search", params=params)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_get_issue(args):
    base_url, token = resolve_auth(args)
    params = {"fields": args.fields} if args.fields else None
    result = request_json(
        base_url,
        token,
        "GET",
        f"/rest/api/2/issue/{args.issue_key}",
        params=params,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_editmeta(args):
    base_url, token = resolve_auth(args)
    result = request_json(
        base_url,
        token,
        "GET",
        f"/rest/api/2/issue/{args.issue_key}/editmeta",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_add_comment(args):
    base_url, token = resolve_auth(args)
    result = request_json(
        base_url,
        token,
        "POST",
        f"/rest/api/2/issue/{args.issue_key}/comment",
        body={"body": args.body},
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_list_transitions(args):
    base_url, token = resolve_auth(args)
    result = request_json(
        base_url,
        token,
        "GET",
        f"/rest/api/2/issue/{args.issue_key}/transitions",
        params={"expand": "transitions.fields"} if args.expand_fields else None,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_transition(args):
    base_url, token = resolve_auth(args)
    body = {"transition": {"id": args.transition_id}}
    if args.comment:
        body["update"] = {"comment": [{"add": {"body": args.comment}}]}
    if args.fields_json:
        fields = json.loads(args.fields_json)
        if not isinstance(fields, dict):
            raise ValueError("--fields-json must decode to a JSON object")
        body["fields"] = fields
    result = request_json(
        base_url,
        token,
        "POST",
        f"/rest/api/2/issue/{args.issue_key}/transitions",
        body=body,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_edit_fields(args):
    base_url, token = resolve_auth(args)
    fields = json.loads(args.fields_json)
    if not isinstance(fields, dict):
        raise ValueError("--fields-json must decode to a JSON object")
    result = request_json(
        base_url,
        token,
        "PUT",
        f"/rest/api/2/issue/{args.issue_key}",
        body={"fields": fields},
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        description="Common Jira operations over REST API with Bearer token auth from AgentSmith Context Store."
    )
    parser.add_argument("--base-url", default=None, help="Jira base URL, for example https://jira.example.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("myself")
    p.set_defaults(func=cmd_myself)

    p = sub.add_parser("search")
    p.add_argument("--jql", required=True)
    p.add_argument("--max-results", type=int, default=10)
    p.add_argument("--fields", default="summary,key,project,status,assignee")
    p.add_argument("--use-post", action="store_true", help="Force POST /search instead of GET")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("get-issue")
    p.add_argument("issue_key")
    p.add_argument("--fields", default=None)
    p.set_defaults(func=cmd_get_issue)

    p = sub.add_parser("editmeta")
    p.add_argument("issue_key")
    p.set_defaults(func=cmd_editmeta)

    p = sub.add_parser("add-comment")
    p.add_argument("issue_key")
    p.add_argument("--body", required=True)
    p.set_defaults(func=cmd_add_comment)

    p = sub.add_parser("list-transitions")
    p.add_argument("issue_key")
    p.add_argument(
        "--expand-fields",
        action="store_true",
        help="Request transition field metadata via expand=transitions.fields",
    )
    p.set_defaults(func=cmd_list_transitions)

    p = sub.add_parser("transition")
    p.add_argument("issue_key")
    p.add_argument("--transition-id", required=True)
    p.add_argument("--comment", default=None)
    p.add_argument(
        "--fields-json",
        default=None,
        help="Optional JSON object for fields required by the transition screen, for example resolution.",
    )
    p.set_defaults(func=cmd_transition)

    p = sub.add_parser("edit-fields")
    p.add_argument("issue_key")
    p.add_argument("--fields-json", required=True)
    p.set_defaults(func=cmd_edit_fields)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

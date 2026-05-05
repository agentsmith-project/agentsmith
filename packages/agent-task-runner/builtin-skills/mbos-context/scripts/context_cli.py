#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def read_api_base() -> str:
    value = os.environ.get("MBOS_AGENT_API_BASE", "").strip()
    if not value:
        raise RuntimeError("MBOS_AGENT_API_BASE is required for mbos-context.")
    return value.rstrip("/")


def read_execution_ticket() -> str:
    value = os.environ.get("MBOS_AGENT_EXECUTION_TICKET", "").strip()
    if not value:
        raise RuntimeError("MBOS_AGENT_EXECUTION_TICKET is required for mbos-context.")
    return value


def read_env_default(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def build_query(args: argparse.Namespace) -> dict[str, str]:
    query: dict[str, str] = {"scope": args.scope}
    if getattr(args, "key", None):
      query["key"] = args.key
    scope = args.scope
    key = getattr(args, "key", None)
    workspace_id = getattr(args, "workspace_id", None) or read_env_default("MBOS_AGENT_WORKSPACE_ID")
    project_id = getattr(args, "project_id", None) or read_env_default("MBOS_AGENT_PROJECT_ID")
    task_id = getattr(args, "task_id", None) or read_env_default("MBOS_AGENT_TASK_ID")
    if workspace_id and scope in ("member", "task", "project_member", "project", "workspace"):
        query["workspace_id"] = workspace_id
    include_project_id = scope in ("task", "project_member", "project") or (
        scope == "member" and isinstance(key, str) and key.startswith("managed_credentials.")
    )
    if project_id and include_project_id:
        query["project_id"] = project_id
    if task_id and scope == "task":
        query["task_id"] = task_id
    return query


def api_request(method: str, path: str, *, query: dict[str, str] | None = None, body: dict[str, Any] | None = None) -> Any:
    api_base = read_api_base()
    token = read_execution_ticket()
    url = f"{api_base}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            if not raw.strip():
                return None
            return json.loads(raw)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Context API HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Context API network error: {exc}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read AgentSmith Context Store entries, and write member/task entries when allowed by the runner ticket.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_scope_args(target: argparse.ArgumentParser, *, needs_key: bool) -> None:
        target.add_argument("--scope", required=True, choices=["member", "task", "project_member", "project", "workspace"])
        if needs_key:
            target.add_argument("--key", required=True)
        else:
            target.add_argument("--key")
        target.add_argument("--workspace-id")
        target.add_argument("--project-id")
        target.add_argument("--task-id")

    get_parser = sub.add_parser("get")
    add_scope_args(get_parser, needs_key=True)
    get_parser.add_argument("--full", action="store_true")

    list_parser = sub.add_parser("list")
    add_scope_args(list_parser, needs_key=False)

    put_parser = sub.add_parser("put")
    add_scope_args(put_parser, needs_key=True)
    put_parser.add_argument("--content")
    put_parser.add_argument("--content-file")
    put_parser.add_argument("--content-type", choices=["text", "json", "markdown", "yaml"], default="text")

    delete_parser = sub.add_parser("delete")
    add_scope_args(delete_parser, needs_key=True)

    refresh_parser = sub.add_parser("refresh-managed-credential")
    refresh_parser.add_argument("--provider", required=True)
    refresh_parser.add_argument("--workspace-id")
    refresh_parser.add_argument("--project-id")

    return parser.parse_args()


def read_put_content(args: argparse.Namespace) -> str:
    if args.content_file:
        return Path(args.content_file).read_text(encoding="utf-8")
    if args.content is not None:
        return args.content
    return sys.stdin.read()


def main() -> int:
    args = parse_args()
    if args.command == "get":
        response = api_request("GET", "/context", query=build_query(args))
        if args.full:
            print(json.dumps(response, ensure_ascii=False, indent=2))
        else:
            print(response.get("content", ""), end="" if response.get("content", "").endswith("\n") else "\n")
        return 0
    if args.command == "list":
        response = api_request("GET", "/context/list", query=build_query(args))
        print(json.dumps(response.get("items", []), ensure_ascii=False, indent=2))
        return 0
    if args.command == "put":
        query = build_query(args)
        payload: dict[str, Any] = {
            "scope": query["scope"],
            "key": query["key"],
            "content": read_put_content(args),
            "content_type": args.content_type,
        }
        for name in ("workspace_id", "project_id", "task_id"):
            if name in query:
                payload[name] = query[name]
        response = api_request("PUT", "/context", body=payload)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0
    if args.command == "delete":
        api_request("DELETE", "/context", query=build_query(args))
        return 0
    if args.command == "refresh-managed-credential":
        query = {}
        if args.workspace_id or read_env_default("MBOS_AGENT_WORKSPACE_ID"):
            query["workspace_id"] = args.workspace_id or read_env_default("MBOS_AGENT_WORKSPACE_ID")
        if args.project_id or read_env_default("MBOS_AGENT_PROJECT_ID"):
            query["project_id"] = args.project_id or read_env_default("MBOS_AGENT_PROJECT_ID")
        response = api_request(
            "POST",
            f"/context/managed-credentials/{args.provider}/refresh",
            query=query or None,
        )
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0
    raise RuntimeError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"{exc}\n")
        raise SystemExit(1)

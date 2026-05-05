import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def read_env_default(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


class ContextStoreClient:
    def __init__(self, *, api_base: str, execution_ticket: str) -> None:
        self.api_base = api_base.rstrip("/")
        self.execution_ticket = execution_ticket

    @classmethod
    def from_runner_env(cls, *, required: bool, unavailable_message: str) -> "ContextStoreClient | None":
        api_base = read_env_default("MBOS_AGENT_API_BASE")
        execution_ticket = read_env_default("MBOS_AGENT_EXECUTION_TICKET")
        if api_base and execution_ticket:
            return cls(api_base=api_base, execution_ticket=execution_ticket)
        if required:
            raise RuntimeError(unavailable_message)
        return None

    def build_query(
        self,
        *,
        scope: str,
        key: str | None = None,
        workspace_id: str | None = None,
        project_id: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, str]:
        query = {"scope": scope}
        if key:
            query["key"] = key
        next_workspace_id = workspace_id or read_env_default("MBOS_AGENT_WORKSPACE_ID")
        next_project_id = project_id or read_env_default("MBOS_AGENT_PROJECT_ID")
        next_task_id = task_id or read_env_default("MBOS_AGENT_TASK_ID")
        if next_workspace_id and scope in ("member", "task", "project_member", "project", "workspace"):
            query["workspace_id"] = next_workspace_id
        include_project_id = scope in ("task", "project_member", "project") or (
            scope == "member" and isinstance(key, str) and key.startswith("managed_credentials.")
        )
        if next_project_id and include_project_id:
            query["project_id"] = next_project_id
        if next_task_id and scope == "task":
            query["task_id"] = next_task_id
        return query

    def request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        allow_not_found: bool = False,
    ) -> dict[str, Any] | None:
        url = f"{self.api_base}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        data = None
        headers = {
            "Authorization": f"Bearer {self.execution_ticket}",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            if allow_not_found and exc.code == 404:
                return None
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

    def get_content(self, *, scope: str, key: str) -> str | None:
        response = self.request_json(
            "GET",
            "/context",
            query=self.build_query(scope=scope, key=key),
            allow_not_found=True,
        )
        if response is None:
            return None
        content = response.get("content")
        return content if isinstance(content, str) and content.strip() else None

    def refresh_managed_credential(self, *, provider: str, workspace_id: str | None = None) -> dict[str, Any]:
        query: dict[str, str] | None = None
        if workspace_id:
            query = {"workspace_id": workspace_id}
        response = self.request_json(
            "POST",
            f"/context/managed-credentials/{provider}/refresh",
            query=query,
        )
        if response is None:
            raise RuntimeError("Managed credential refresh returned empty response.")
        return response


def _read_json_file(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Skill capability contract at {path} must be a JSON object.")
    return payload


def resolve_skill_root(script_file: str | Path) -> Path:
    path = Path(script_file).resolve()
    if path.parent.name == "scripts":
        return path.parent.parent
    return path.parent


def load_skill_capability_contract(script_file: str | Path) -> dict[str, Any]:
    skill_root = resolve_skill_root(script_file)
    contract_path = skill_root / "capabilities.json"
    if not contract_path.is_file():
        raise RuntimeError(f"Skill capability contract not found: {contract_path}")
    payload = _read_json_file(contract_path)
    if payload.get("version") != 1:
        raise RuntimeError(f"Skill capability contract version is unsupported: {contract_path}")
    return payload


def find_dependency(contract: dict[str, Any], dependency_name: str) -> dict[str, Any]:
    dependencies = contract.get("dependencies")
    if not isinstance(dependencies, list):
        raise RuntimeError("Skill capability contract is missing dependencies.")
    for dependency in dependencies:
        if isinstance(dependency, dict) and dependency.get("name") == dependency_name:
            return dependency
    skill_name = contract.get("skill_name", "unknown-skill")
    raise RuntimeError(f"Dependency '{dependency_name}' is not defined for skill '{skill_name}'.")


def resolve_simple_credential_dependency(script_file: str | Path, dependency_name: str) -> dict[str, str]:
    contract = load_skill_capability_contract(script_file)
    dependency = find_dependency(contract, dependency_name)
    if dependency.get("kind") != "simple_credential_bundle":
        raise RuntimeError(f"Dependency '{dependency_name}' is not a simple credential bundle.")
    client = ContextStoreClient.from_runner_env(
        required=False,
        unavailable_message="Context API is unavailable in this runner session.",
    )
    if client is None:
        return {}
    scopes = dependency.get("scopes")
    fields = dependency.get("fields")
    if not isinstance(scopes, list) or not isinstance(fields, list):
        raise RuntimeError(f"Dependency '{dependency_name}' is missing scopes or fields.")
    resolved: dict[str, str] = {}
    for field in fields:
        if not isinstance(field, dict):
            continue
        field_name = field.get("name")
        keys = field.get("keys")
        if not isinstance(field_name, str) or not isinstance(keys, list):
            continue
        for scope in scopes:
            if not isinstance(scope, str):
                continue
            for key in keys:
                if not isinstance(key, str):
                    continue
                value = client.get_content(scope=scope, key=key)
                if isinstance(value, str) and value.strip():
                    resolved[field_name] = value.strip()
                    break
            if field_name in resolved:
                break
    return resolved


def _parse_projected_content(payload: dict[str, Any], *, empty_message: str, invalid_message: str) -> dict[str, Any]:
    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(empty_message)
    projected = json.loads(content)
    if not isinstance(projected, dict):
        raise RuntimeError(invalid_message)
    return projected


def resolve_managed_credential_dependency(script_file: str | Path, dependency_name: str) -> dict[str, Any]:
    contract = load_skill_capability_contract(script_file)
    dependency = find_dependency(contract, dependency_name)
    if dependency.get("kind") != "managed_credential":
        raise RuntimeError(f"Dependency '{dependency_name}' is not a managed credential dependency.")
    provider = dependency.get("provider")
    scope = dependency.get("scope")
    if not isinstance(provider, str) or scope not in ("member", "project_member"):
        raise RuntimeError(f"Dependency '{dependency_name}' is missing provider or supported scope.")
    client = ContextStoreClient.from_runner_env(
        required=True,
        unavailable_message="Managed credentials are unavailable. This skill requires AgentSmith runtime context access in notebook or terminal sessions.",
    )
    if client is None:
        raise RuntimeError("Managed credentials are unavailable.")
    project_id = read_env_default("MBOS_AGENT_PROJECT_ID") if scope == "project_member" else None
    if scope == "project_member" and not project_id:
        raise RuntimeError(f"Managed credential dependency '{dependency_name}' requires project scope.")
    response = client.request_json(
        "GET",
        "/context",
        query=client.build_query(
            scope="member",
            key=f"managed_credentials.{provider}",
            project_id=project_id,
        ),
    )
    if response is None:
        raise RuntimeError(f"Managed credential dependency '{dependency_name}' returned empty response.")
    return _parse_projected_content(
        response,
        empty_message=f"Managed credential dependency '{dependency_name}' is empty.",
        invalid_message=f"Managed credential dependency '{dependency_name}' is invalid.",
    )


def refresh_managed_credential_dependency(script_file: str | Path, dependency_name: str) -> dict[str, Any]:
    contract = load_skill_capability_contract(script_file)
    dependency = find_dependency(contract, dependency_name)
    if dependency.get("kind") != "managed_credential":
        raise RuntimeError(f"Dependency '{dependency_name}' is not a managed credential dependency.")
    if dependency.get("refresh_supported") is False:
        raise RuntimeError(f"Dependency '{dependency_name}' does not support refresh.")
    provider = dependency.get("provider")
    scope = dependency.get("scope")
    if not isinstance(provider, str):
        raise RuntimeError(f"Dependency '{dependency_name}' is missing provider.")
    if scope not in ("member", "project_member"):
        raise RuntimeError(f"Dependency '{dependency_name}' is missing supported scope.")
    client = ContextStoreClient.from_runner_env(
        required=True,
        unavailable_message="Managed credentials are unavailable. This skill requires AgentSmith runtime context access in notebook or terminal sessions.",
    )
    if client is None:
        raise RuntimeError("Managed credentials are unavailable.")
    workspace_id = read_env_default("MBOS_AGENT_WORKSPACE_ID")
    project_id = read_env_default("MBOS_AGENT_PROJECT_ID") if scope == "project_member" else None
    if scope == "project_member" and not project_id:
        raise RuntimeError(f"Managed credential dependency '{dependency_name}' requires project scope.")
    response = client.request_json(
        "POST",
        f"/context/managed-credentials/{provider}/refresh",
        query={
            **({"workspace_id": workspace_id} if workspace_id else {}),
            **({"project_id": project_id} if project_id else {}),
        } or None,
    )
    return _parse_projected_content(
        response,
        empty_message=f"Managed credential refresh for '{dependency_name}' returned empty content.",
        invalid_message=f"Managed credential refresh for '{dependency_name}' returned invalid content.",
    )

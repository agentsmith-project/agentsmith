#!/usr/bin/env python3
import json
import pathlib
import sys


def load_env_keys(path: pathlib.Path) -> set[str]:
    keys: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip())
    return keys


def main() -> int:
    if len(sys.argv) < 3:
      raise SystemExit("usage: check-required-env-templates.py <manifest> <env-template> [<env-template>...]")

    manifest_path = pathlib.Path(sys.argv[1])
    template_paths = [pathlib.Path(arg) for arg in sys.argv[2:]]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    env_keys: set[str] = set()
    for template_path in template_paths:
        env_keys.update(load_env_keys(template_path))

    for group_name, group in manifest.get("required_env", {}).items():
        for key in group:
            if key not in env_keys:
                raise SystemExit(f"missing_env_template_key:{group_name}:{key}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

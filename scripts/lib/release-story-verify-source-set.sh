#!/usr/bin/env bash

release_story_verify_source_set_name() {
  printf '%s\n' 'backend_real_story_verify_source_set'
}

release_story_verify_source_set_helper_path() {
  printf '%s\n' 'scripts/lib/release-story-verify-source-set.sh'
}

release_story_verify_story_root_relpath() {
  printf '%s\n' 'e2e/stories/backend-real'
}

release_story_verify_contract_files() {
  cat <<'EOF'
e2e/integration-release-user-story.spec.ts
e2e/release-user-story.contract.ts
e2e/story-contract.ts
e2e/story-generated-spec.ts
e2e/story-loader.ts
e2e/story-trace-binding.ts
e2e/trace-bundle-support.ts
e2e/generated/story-specs.generated.json
EOF
}

release_story_verify_support_source_files() {
  cat <<'EOF'
packages/contracts/src/auth-handoff-paths.ts
EOF
}

release_story_verify_source_set() {
  local root_dir="${1:-${ROOT_DIR:-$(pwd)}}"
  local story_root_relpath
  local story_root
  local relative_path

  story_root_relpath="$(release_story_verify_story_root_relpath)"
  story_root="${root_dir%/}/${story_root_relpath}"

  release_story_verify_contract_files
  release_story_verify_support_source_files

  if [[ ! -d "${story_root}" ]]; then
    echo "missing release story root: ${story_root}" >&2
    return 1
  fi

  while IFS= read -r relative_path; do
    [[ -n "${relative_path}" ]] || continue
    printf '%s\n' "${relative_path#${root_dir%/}/}"
  done < <(find "${story_root}" -type f -name '*.story.md' | sort)
}

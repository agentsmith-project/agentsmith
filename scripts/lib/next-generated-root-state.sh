#!/usr/bin/env bash

next_generated_root_repo_dir() {
  printf '%s\n' "${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
}

next_generated_root_canonical_next_env() {
  cat <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF
}

next_generated_root_normalize() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"

  node - <<'NODE' "${repo_dir}/tsconfig.json"
const fs = require('node:fs');
const tsconfigPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
const originalInclude = Array.isArray(config.include)
  ? config.include.filter((entry) => typeof entry === 'string')
  : [];

const requiredPatterns = [
  '.next*/types/**/*.ts',
  'artifacts/backend-real/runs/*/next-dist/types/**/*.ts',
  'artifacts/mock-lane/runs/*/next-dist/types/**/*.ts',
];

const managedEntryPattern =
  /(?:^|\/)(?:mock|integration)-\d{8}T\d{6}Z-\d+-\d+(?:\/|$)|\.next-backend-real-|\.next-mock-|\/next-dist\/types\//;

const filtered = originalInclude.filter((entry) => !managedEntryPattern.test(entry));
const deduped = [];
for (const entry of filtered) {
  if (!deduped.includes(entry)) {
    deduped.push(entry);
  }
}

const normalizedInclude = [];
for (const pattern of requiredPatterns) {
  if (!normalizedInclude.includes(pattern)) {
    normalizedInclude.push(pattern);
  }
}
for (const entry of deduped) {
  if (!normalizedInclude.includes(entry)) {
    normalizedInclude.push(entry);
  }
}

config.include = normalizedInclude;
fs.writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

  next_generated_root_canonical_next_env > "${repo_dir}/next-env.d.ts"
}

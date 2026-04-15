#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

exec npx tsx scripts/governance/run-current-verification-campaign.ts release-full "$@"

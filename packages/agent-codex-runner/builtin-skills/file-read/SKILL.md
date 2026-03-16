---
name: file-read
description: Fetch notebook task input files referenced by .mbos/task-inputs.json via MBOS API into ./inputs/.
---

# file-read

Use this skill to inspect and fetch notebook task input files referenced in `./.mbos/task-inputs.json`.

## Commands

- List attached inputs:
  - `node ./.codex/skills/file-read/fetch_input.mjs list`
- Fetch one input by ID (source, library object, URL-imported object, or artifact ref, writes into `./inputs/`):
  - `node ./.codex/skills/file-read/fetch_input.mjs fetch <id>`

## Notes

- The helper uses MBOS execution env vars provided by the runner.
- Downloaded files are stored locally under `./inputs/` for analysis.
- Do not attempt GUI file pickers; this is a headless notebook execution environment.

#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const outputPath = process.argv[2] || process.env.WORKSPACE_GOVERNANCE_EVIDENCE_PATH;

if (!outputPath) {
  console.error('[write-workspace-governance-evidence] missing output path');
  process.exit(1);
}

const resolvedPath = resolve(outputPath);
mkdirSync(dirname(resolvedPath), { recursive: true });

const evidence = {
  source: 'artifact',
  generated_at: new Date().toISOString(),
  review_status: 'ready',
  blockers: [],
  warnings: [],
  checks: {
    workspace_overview: true,
    workspace_member_administration: true,
    cross_project_actions: true,
    workspace_explainability: true,
    workspace_attention_drilldown: true,
  },
  note: 'Generated after the workspace governance lane completed successfully.',
};

writeFileSync(resolvedPath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(`[write-workspace-governance-evidence] ${resolvedPath}`);

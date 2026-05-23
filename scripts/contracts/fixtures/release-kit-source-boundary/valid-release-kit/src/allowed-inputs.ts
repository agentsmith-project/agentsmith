import { readFileSync } from 'node:fs';

const releaseContract = readFileSync('inputs/release-contract.json', 'utf8');
const deployTemplatePackageManifest = readFileSync('inputs/deploy-template-package/manifest.json', 'utf8');
const renderedManifest = readFileSync('artifacts/rendered-manifests/agentsmith.yaml', 'utf8');
const rolloutEvidence = readFileSync('artifacts/evidence/rollout-report.json', 'utf8');

export const allowedReleaseKitInputs = {
  releaseContract,
  deployTemplatePackageManifest,
  renderedManifest,
  rolloutEvidence,
};

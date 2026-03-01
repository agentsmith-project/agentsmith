import * as releasePolicyModule from '../../../src/lib/release-policy.js';

type ReleasePolicyModule = typeof import('../../../src/lib/release-policy.js');

const releasePolicyExports = (
  'default' in releasePolicyModule
    ? (releasePolicyModule.default as ReleasePolicyModule)
    : (releasePolicyModule as ReleasePolicyModule)
);

export const enforceReleasePolicy = releasePolicyExports.enforceReleasePolicy;
export const evaluateReleasePolicy = releasePolicyExports.evaluateReleasePolicy;
export const mergeReleasePolicyEvaluations = releasePolicyExports.mergeReleasePolicyEvaluations;

export type ReleasePolicyEvaluation = import('../../../src/lib/release-policy.js').ReleasePolicyEvaluation;

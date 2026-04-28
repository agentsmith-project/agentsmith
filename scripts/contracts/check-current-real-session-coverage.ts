import {
  CURRENT_REAL_SESSION_COVERAGE_MANIFEST,
  discoverCurrentRealSessionCoverageRequiredSources,
  validateCurrentRealSessionCoverageManifest,
} from '../governance/current-real-session-coverage-manifest';

const discovery = discoverCurrentRealSessionCoverageRequiredSources();
const result = validateCurrentRealSessionCoverageManifest(CURRENT_REAL_SESSION_COVERAGE_MANIFEST, {
  requiredSources: discovery.sources,
  discoveryFailures: discovery.failures,
});

if (!result.ok) {
  console.error('[contracts] current real session coverage check failed:');
  for (const failure of result.failures) {
    const id = failure.id ? ` (${failure.id})` : '';
    console.error(`- ${failure.path}${id}: ${failure.reason}`);
  }
  process.exit(1);
}

console.log(`[contracts] current real session coverage check passed (${discovery.sources.length} required sources)`);

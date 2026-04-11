import { readFileSync } from 'node:fs';

type TsConfigShape = {
  include?: unknown;
};

const config = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as TsConfigShape;
const include = Array.isArray(config.include) ? config.include.filter((item): item is string => typeof item === 'string') : [];

const requiredPatterns = [
  '.next*/types/**/*.ts',
  'artifacts/mock-lane/current/next-dist/types/**/*.ts',
  'artifacts/backend-real/current-run/next-dist/types/**/*.ts',
];

for (const pattern of requiredPatterns) {
  if (!include.includes(pattern)) {
    throw new Error(`tsconfig_next_dist_include_missing:${pattern}`);
  }
}

const hardCodedRunIdPattern = /(?:^|\/)(?:mock|integration)-\d{8}T\d{6}Z-\d+-\d+(?:\/|$)|\.next-backend-real-/;
for (const entry of include) {
  if (hardCodedRunIdPattern.test(entry)) {
    throw new Error(`tsconfig_next_dist_include_must_use_wildcards:${entry}`);
  }
}

try {
  const nextEnv = readFileSync('next-env.d.ts', 'utf8');
  const pollutedNextEnvPattern =
    /(?:artifacts\/(?:mock-lane|backend-real)\/runs\/|\.next-backend-real-|\.next-mock-|\/next-dist\/types\/routes\.d\.ts)/;
  if (pollutedNextEnvPattern.test(nextEnv)) {
    throw new Error('next_env_must_not_reference_lane_specific_types');
  }
} catch (error) {
  if (!(error instanceof Error) || !/ENOENT/.test(String(error.message))) {
    throw error;
  }
}

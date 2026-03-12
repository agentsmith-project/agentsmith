import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FORBIDDEN_KEYS = ['limit_total', 'total_limit', 'limit_limit', 'total_limit_limit'];

const USAGE_LIMITS_FILES = [
  'src/lib/api/endpoints/audit-usage.ts',
  'src/components/audit-usage/UsagePage.tsx',
  'src/components/audit-usage/UsageView.tsx',
  'src/mocks/handlers/usage.ts',
];

function fileContainsForbidden(content: string): string[] {
  return FORBIDDEN_KEYS.filter((key) => new RegExp(`\\b${key}\\b`).test(content));
}

describe('usage limits naming boundary', () => {
  it('keeps deprecated limits-summary keys out of usage path files', () => {
    const violations: Array<{ file: string; keys: string[] }> = [];

    for (const relativePath of USAGE_LIMITS_FILES) {
      const absolutePath = path.resolve(ROOT, relativePath);
      const content = fs.readFileSync(absolutePath, 'utf8');
      const keys = fileContainsForbidden(content);
      if (keys.length > 0) {
        violations.push({ file: relativePath, keys });
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps limits-summary schemas on canonical naming in OpenAPI', () => {
    const openApiPath = path.resolve(ROOT, 'docs/contracts/specs/openapi.json');
    const openApi = JSON.parse(fs.readFileSync(openApiPath, 'utf8')) as {
      components?: { schemas?: Record<string, unknown> };
      paths?: Record<string, Record<string, unknown>>;
    };

    const schemas = openApi.components?.schemas ?? {};
    const targets = ['LimitOverview', 'EndpointLimitSummary', 'LimitRuleSnapshot', 'ProjectLimitSummary']
      .map((schemaName) => schemas[schemaName])
      .filter((schema): schema is Record<string, unknown> => !!schema && typeof schema === 'object');
    const serialized = JSON.stringify(targets);
    const violatingKeys = fileContainsForbidden(serialized);
    expect(violatingKeys).toEqual([]);
  });
});

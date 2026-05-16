export const DEFAULT_WORKFLOW_SURFACE_DOC_PATHS = [
  'README.md',
  'DEVELOPMENT.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/testing/diagnostic-catalog-v1.md',
] as const;

export interface InternalWorkflowReferenceViolation {
  relativePath: string;
  lineNumber: number;
  command: string;
  context: string;
}

const INTERNAL_WORKFLOW_COMMAND_PATTERN =
  /\b(?:npm run (?:(?:test|gate|lane|backend-real):[a-z0-9:_-]+|release:campaign:[a-z0-9:_-]+)|make (?:local-manual|substrate)-[a-z0-9_-]+|RELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full|npx tsx scripts\/unified-deploy\/substrate-lifecycle\.ts(?:\s+[a-z0-9:_-]+)?|(?:gate|lane|backend-real|release:campaign):[a-z0-9:_-]+)\b/g;

const INTERNAL_WORKFLOW_CONTEXT_PATTERN =
  /诊断|维护者诊断|维护者排障|机器可读报告|Diagnostic|Diagnostics|Diagnostic Commands|Maintainer Diagnostic|Maintainer Diagnostics|Maintainer Troubleshooting|Machine-Readable Reports|Owner Diagnostics|owner diagnostics|owner runbook|evidence-owner|evidence owner|producer/i;

function lineNumberAtIndex(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function internalReferenceContext(content: string, lineNumber: number): string {
  const lines = content.split('\n');
  const lineIndex = lineNumber - 1;
  const headingStack = lines
    .slice(0, lineIndex + 1)
    .filter((line) => /^#{1,4}\s+/.test(line.trim()))
    .slice(-4)
    .join('\n');
  const surrounding = lines
    .slice(Math.max(0, lineIndex - 4), Math.min(lines.length, lineIndex + 5))
    .join('\n');
  return `${headingStack}\n${surrounding}`;
}

export function findInternalWorkflowReferenceViolations(input: {
  relativePath: string;
  content: string;
}): readonly InternalWorkflowReferenceViolation[] {
  const violations: InternalWorkflowReferenceViolation[] = [];
  for (const match of input.content.matchAll(INTERNAL_WORKFLOW_COMMAND_PATTERN)) {
    const lineNumber = lineNumberAtIndex(input.content, match.index ?? 0);
    const context = internalReferenceContext(input.content, lineNumber);
    if (!INTERNAL_WORKFLOW_CONTEXT_PATTERN.test(context)) {
      violations.push({
        relativePath: input.relativePath,
        lineNumber,
        command: match[0],
        context,
      });
    }
  }
  return violations;
}

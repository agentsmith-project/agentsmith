import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type AsbcpImageOnlyFailure = {
  path: string;
  line: number;
  message: string;
};

type AsbcpImageOnlyResult = {
  ok: boolean;
  failures: AsbcpImageOnlyFailure[];
};

type ForbiddenPattern = {
  label: string;
  pattern: RegExp;
  appliesTo?: (file: string) => boolean;
  checkPath?: boolean;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const ACTIVE_SCAN_ROOTS = [
  'infra/deploy',
  'infra/flows',
  'e2e',
  'docs/contracts',
  'docs/UXUI',
  'docs/user-guides',
  'scripts/unified-deploy',
  'scripts/lib',
  'packages/api-entry-node/src',
  'scripts/local-manual',
  'src',
] as const;

const ACTIVE_SCAN_FILES = [
  'Makefile',
  'package.json',
  'docs/engineering/archive/agentsmith-sandbox-control-plane-release-independence-plan-v1.md',
  'scripts/lib/internal-sandbox-real-control.sh',
  'scripts/run-internal-agent-task-real-gate.sh',
  'scripts/run-integration-release-user-story.sh',
  'scripts/run-integration-e2e-full.sh',
  'scripts/run-release-local-precheck.sh',
  'scripts/run-file-library-real-gate.sh',
  'scripts/sandbox-joint-integration-smoke.sh',
  'scripts/backend-real-full-gate.sh',
  'docs/contracts/product-terminology.md',
  'docs/contracts/unified-deploy-contract.md',
] as const;

const ACTIVE_EXTENSIONS = new Set(['.json', '.ts', '.tsx', '.sh', '.tpl', '.env', '.example', '.lock', '.md', '']);
const EXCLUDED_PATH_PATTERN = /(?:^|\/)(?:node_modules|dist|coverage|artifacts|\.next)\/|(?:^|\/)fonts\/assets\//u;

const NEGATIVE_FIXTURE_FILES = new Set([
  'packages/api-entry-node/src/node-api-deps-factory.optional-sandbox.test.ts',
  'scripts/contracts/check-asbcp-image-only.test.ts',
  'scripts/lib/internal-sandbox-real-control.test.ts',
  'scripts/unified-deploy/address-truth.test.ts',
  'scripts/unified-deploy/local-kind-images.test.ts',
  'scripts/unified-deploy/substrate-boundary.test.ts',
  'src/components/agent-tasks/__tests__/ConversationPanel.test.tsx',
  'src/components/agent-tasks/__tests__/TaskHeader.test.tsx',
  'src/components/agent-tasks/__tests__/TaskTerminalPanel.test.tsx',
  'src/lib/api/__tests__/errors.test.ts',
]);

const MIGRATION_NOTE_FILES = new Set([
  'docs/engineering/archive/agentsmith-sandbox-control-plane-release-independence-plan-v1.md',
]);
const HISTORICAL_REFERENCE_LINE_LIMIT = 40;
const HISTORICAL_REFERENCE_SENTINELS = [
  /\bhistorical\/reference\b/iu,
  /\bHistorical\/reference migration note\b/iu,
] as const;

const SANITIZER_IMPLEMENTATION_FILES = new Set([
  'src/lib/api/errors.ts',
]);

const LEGACY_RESIDUE_NEGATIVE_EVIDENCE_ALLOWANCE = {
  file: 'scripts/unified-deploy/asbcp-legacy-residue-negative-evidence.ts',
  reason: 'allow-asbcp-legacy-residue-negative-evidence',
  labels: new Set([
    'legacy ASBCP Kubernetes identity',
    'legacy ASBCP component name',
    'legacy ASBCP component snake name',
  ]),
} as const;

const PRODUCT_CONTRACT_DOC_FILES = new Set([
  'docs/contracts/auth-permission-model.md',
  'docs/contracts/frontend-backend-gating-matrix.md',
  'docs/contracts/frontend-resource-policy-governance-v1.md',
  'docs/contracts/product-terminology.md',
  'docs/contracts/route-gate-test-checklist.md',
  'docs/contracts/usage-limits-summary-contract.md',
  'docs/contracts/user-story-contract-v1.md',
]);

function isProductContractDoc(file: string): boolean {
  return (
    PRODUCT_CONTRACT_DOC_FILES.has(file)
    || /^docs\/contracts\/[^/]+-frontend-module-map\.md$/u.test(file)
  );
}

function isUserFacingSurface(file: string): boolean {
  if (file.startsWith('docs/user-guides/')) {
    return true;
  }
  if (file.startsWith('docs/UXUI/')) {
    return true;
  }
  if (isProductContractDoc(file)) {
    return true;
  }
  if (!file.startsWith('src/')) {
    return false;
  }

  return !file.startsWith('src/app/api/');
}

function isBrowserOrClientSurface(file: string): boolean {
  if (!file.startsWith('src/')) {
    return false;
  }

  return !file.startsWith('src/app/api/');
}

const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  {
    label: 'sibling ASBCP source path',
    pattern: /\.\.\/mbos-sandbox-v1|\bmbos-sandbox-v1\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP Kubernetes identity',
    pattern: /\bagentsmith-sandbox-manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP component name',
    pattern: /\bsandbox-manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP manager display name',
    pattern: /\bsandbox manager\b/iu,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP component snake name',
    pattern: /\bsandbox_manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP manager camel name',
    pattern: /\b[Ss]andboxManager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP env prefix',
    pattern: /\bSANDBOX_MANAGER[A-Z0-9_]*\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP service key env',
    pattern: /\bSANDBOX_SERVICE_KEY\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP source dir env',
    pattern: /\bSANDBOX_SOURCE_DIR\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP source dir flag',
    pattern: /(?:^|[^\w-])--sandbox-source-dir\b/u,
    checkPath: true,
  },
  {
    label: 'legacy local-kind ASBCP image repo',
    pattern: /\bmbos\/sandbox-manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP module path',
    pattern: /\bgithub\.com\/sandbox\/manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP manager command alias',
    pattern: /\b(?:start|stop|restart)-manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP manager source command path',
    pattern: /(?:^|[^\w.])(?:\.\/)?cmd\/manager\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP cleaner source command path',
    pattern: /(?:^|[^\w.])(?:\.\/)?cmd\/cleaner\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP sandboxes API path',
    pattern: /\/v1\/sandboxes\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP config path',
    pattern: /\/etc\/asbcp\/config\.yaml\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP manager config path',
    pattern: /\/etc\/sandbox-manager\/manager-config\.yaml\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP sandbox control plane env prefix',
    pattern: /\bSANDBOX_CONTROL_PLANE[A-Z0-9_]*\b/u,
    checkPath: true,
  },
  {
    label: 'legacy ASBCP sandbox control plane symbol',
    pattern: /\b[Ss]andboxControlPlane\b|\bsandbox_control_plane\b/u,
    checkPath: true,
  },
  {
    label: 'public ASBCP browser env',
    pattern: /\bNEXT_PUBLIC_ASBCP_[A-Z0-9_]*\b/u,
  },
  {
    label: 'ASBCP service key browser/client surface',
    pattern: /\bASBCP_SERVICE_KEY\b/u,
    appliesTo: isBrowserOrClientSurface,
  },
  {
    label: 'user-facing ASBCP term',
    pattern: /\basbcp\b/iu,
    appliesTo: isUserFacingSurface,
    checkPath: true,
  },
  {
    label: 'user-facing ASBCP internal base URL',
    pattern: /\bASBCP_INTERNAL_BASE_URL\b/u,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing ASBCP service key',
    pattern: /\bASBCP_SERVICE_KEY\b/u,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing ASBCP image input',
    pattern: /\bASBCP_IMAGE\b/u,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing ASBCP image reference',
    pattern: /\bghcr\.io\b/iu,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing image digest',
    pattern: /@sha256:[a-f0-9]{6,}\b/iu,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing control plane terminology',
    pattern: /\bcontrol plane\b/iu,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing workload lifecycle terminology',
    pattern: /\bworkload lifecycle\b/iu,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing sandbox workload terminology',
    pattern: /\bsandbox workload\b/iu,
    appliesTo: isUserFacingSurface,
  },
  {
    label: 'user-facing sandbox terminology',
    pattern: /(?:^|[^\w-])sandbox(?![\w-])/iu,
    appliesTo: isUserFacingSurface,
    checkPath: true,
  },
  {
    label: 'user-facing internal URL terminology',
    pattern: /\binternal URL\b|\bhttps?:\/\/[^\s"'<>]*asbcp[^\s"'<>]*(?:\.internal|\.svc|\.cluster\.local)[^\s"'<>]*/iu,
    appliesTo: isUserFacingSurface,
  },
] as const;

function hasHistoricalReferenceSentinel(source: string): boolean {
  return source
    .split(/\r?\n/u)
    .slice(0, HISTORICAL_REFERENCE_LINE_LIMIT)
    .some((line) => HISTORICAL_REFERENCE_SENTINELS.some((pattern) => pattern.test(line)));
}

function isAllowedForbiddenReference(file: string, source: string): boolean {
  return (
    NEGATIVE_FIXTURE_FILES.has(file)
    || (MIGRATION_NOTE_FILES.has(file) && hasHistoricalReferenceSentinel(source))
    || SANITIZER_IMPLEMENTATION_FILES.has(file)
  );
}

function isAllowedLegacyResidueNegativeEvidence(file: string, line: string, forbidden: ForbiddenPattern): boolean {
  return file === LEGACY_RESIDUE_NEGATIVE_EVIDENCE_ALLOWANCE.file
    && line.includes(LEGACY_RESIDUE_NEGATIVE_EVIDENCE_ALLOWANCE.reason)
    && LEGACY_RESIDUE_NEGATIVE_EVIDENCE_ALLOWANCE.labels.has(forbidden.label);
}

function isAllowedProductTerminologyClassifier(file: string, line: string): boolean {
  return (
    file === 'docs/contracts/product-terminology.md'
    && (
      line.includes('execution service (ASBCP)')
      || line.includes('ASBCP is a developer/operator deployment term only')
    )
  );
}

function isAllowedUserFacingSandboxReference(file: string, line: string, forbidden: ForbiddenPattern): boolean {
  return forbidden.label === 'user-facing sandbox terminology'
    && (
      (
        file === 'docs/contracts/product-terminology.md'
        && line.includes('the internal sandbox')
      )
      || (
        file === 'docs/user-guides/uxui-review-runbook.md'
        && line.includes('sandbox runner')
        && line.includes('owner diagnostic')
      )
    );
}

function patternAppliesToFile(forbidden: ForbiddenPattern, file: string): boolean {
  return forbidden.appliesTo === undefined || forbidden.appliesTo(file);
}

function repoPath(path: string, rootDir: string): string {
  return resolve(rootDir, path);
}

function collectFiles(rootDir: string): string[] {
  const files = new Set<string>();

  function visit(relativeDir: string): void {
    const absoluteDir = repoPath(relativeDir, rootDir);
    if (!existsSync(absoluteDir)) {
      return;
    }
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = join(relativeDir, entry.name).split('\\').join('/');
      if (EXCLUDED_PATH_PATTERN.test(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(relativePath);
        continue;
      }
      if (entry.isFile() && ACTIVE_EXTENSIONS.has(extname(entry.name))) {
        files.add(relativePath);
      }
    }
  }

  for (const root of ACTIVE_SCAN_ROOTS) {
    visit(root);
  }
  for (const file of ACTIVE_SCAN_FILES) {
    if (existsSync(repoPath(file, rootDir))) {
      files.add(file);
    }
  }

  return [...files].sort();
}

export function collectAsbcpImageOnlyFiles(options: { rootDir?: string } = {}): string[] {
  return collectFiles(options.rootDir ?? REPO_ROOT);
}

export function checkAsbcpImageOnly(options: { rootDir?: string } = {}): AsbcpImageOnlyResult {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const failures: AsbcpImageOnlyFailure[] = [];

  for (const file of collectFiles(rootDir)) {
    const source = readFileSync(repoPath(file, rootDir), 'utf8');
    const isAllowedReference = isAllowedForbiddenReference(file, source);
    if (!isAllowedReference) {
      for (const forbidden of FORBIDDEN_PATTERNS) {
        if (forbidden.checkPath !== true || !patternAppliesToFile(forbidden, file)) {
          continue;
        }
        if (forbidden.pattern.test(file)) {
          failures.push({
            path: file,
            line: 0,
            message: `active AgentSmith ASBCP consumer file paths must not contain ${forbidden.label}`,
          });
        }
      }
    }

    source.split(/\r?\n/u).forEach((line, index) => {
      for (const forbidden of FORBIDDEN_PATTERNS) {
        if (!patternAppliesToFile(forbidden, file)) {
          continue;
        }
        if (
          forbidden.pattern.test(line)
          && !isAllowedReference
          && !isAllowedLegacyResidueNegativeEvidence(file, line, forbidden)
          && !isAllowedProductTerminologyClassifier(file, line)
          && !isAllowedUserFacingSandboxReference(file, line, forbidden)
        ) {
          failures.push({
            path: file,
            line: index + 1,
            message: `active AgentSmith ASBCP consumer paths must not contain ${forbidden.label}`,
          });
        }
      }
    });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkAsbcpImageOnly();
  if (!result.ok) {
    process.stderr.write(`${result.failures.map((failure) =>
      `${failure.path}:${failure.line}: ${failure.message}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('[contracts] ASBCP image-only guard passed\n');
  }
}

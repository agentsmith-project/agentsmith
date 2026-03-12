import { spawn } from 'node:child_process';
import { getGovernanceRunDetail } from './governance-run-store.js';

export type GovernanceRunnerOperation = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: 'full' | 'failed_only';
  started_at: string;
  completed_at?: string;
  report_name: string;
  source_run_id?: string;
  requested_check_ids?: string[];
  actor_user_id?: string;
  actor_name?: string;
  notes?: string;
  error?: string;
};

export type GovernanceRunnerStatus = {
  running: boolean;
  current_operation?: GovernanceRunnerOperation;
  recent_operations: GovernanceRunnerOperation[];
};

export type GovernanceRunnerController = {
  getStatus(): GovernanceRunnerStatus;
  triggerRun(params: {
    mode: 'full' | 'failed_only';
    actorUserId: string;
    actorName?: string;
    notes?: string;
    sourceRunId?: string;
  }): Promise<GovernanceRunnerOperation>;
};

type GovernanceRunnerDeps = {
  cwd?: string;
  governanceRunsDir: string;
  executeGovernanceReport?: (args: string[]) => Promise<void>;
};

const CHECK_ID_BY_NAME: Record<string, string> = {
  'TypeScript typecheck': 'typecheck',
  'OpenAPI generated check': 'openapi-check',
  'OpenAPI contract checks': 'contracts-check',
  'Mainline governance smoke': 'smoke-main',
  'Governance smoke': 'smoke-governance',
};

function timestampSuffix(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildReportName(mode: 'full' | 'failed_only', sourceRunId?: string): string {
  const suffix = timestampSuffix();
  if (mode === 'failed_only' && sourceRunId) {
    return `governance-rerun-${sourceRunId}-${suffix}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  }
  return `governance-manual-${suffix}`;
}

async function defaultExecuteGovernanceReport(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', 'governance:report', '--', ...args], {
      cwd,
      env: process.env,
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `governance_runner_failed_${code ?? 'unknown'}`));
    });
  });
}

function resolveFailedCheckIds(governanceRunsDir: string, sourceRunId?: string): string[] {
  if (!sourceRunId) return [];
  const run = getGovernanceRunDetail(governanceRunsDir, sourceRunId);
  if (!run) return [];
  if (Array.isArray(run.failed_check_ids) && run.failed_check_ids.length > 0) {
    return run.failed_check_ids;
  }
  return run.failed_step_names
    .map((name) => CHECK_ID_BY_NAME[name])
    .filter((value): value is string => Boolean(value));
}

export function createGovernanceRunner(deps: GovernanceRunnerDeps): GovernanceRunnerController {
  let currentOperation: GovernanceRunnerOperation | undefined;
  const recentOperations: GovernanceRunnerOperation[] = [];
  const cwd = deps.cwd ?? process.cwd();

  return {
    getStatus() {
      return {
        running: Boolean(currentOperation),
        current_operation: currentOperation,
        recent_operations: recentOperations.slice(0, 10),
      };
    },
    async triggerRun(params) {
      if (currentOperation) {
        throw new Error('governance_runner_busy');
      }
      const requestedCheckIds = params.mode === 'failed_only'
        ? resolveFailedCheckIds(deps.governanceRunsDir, params.sourceRunId)
        : undefined;
      if (params.mode === 'failed_only' && (!requestedCheckIds || requestedCheckIds.length === 0)) {
        throw new Error('governance_runner_no_failed_checks');
      }
      const reportName = buildReportName(params.mode, params.sourceRunId);
      const operation: GovernanceRunnerOperation = {
        id: reportName,
        status: 'running',
        mode: params.mode,
        started_at: new Date().toISOString(),
        report_name: reportName,
        source_run_id: params.sourceRunId,
        requested_check_ids: requestedCheckIds,
        actor_user_id: params.actorUserId,
        actor_name: params.actorName,
        notes: params.notes,
      };
      currentOperation = operation;
      recentOperations.unshift(operation);

      const args = [
        '--name', reportName,
        '--trigger', 'manual',
        '--actor-user-id', params.actorUserId,
      ];
      if (params.actorName) {
        args.push('--actor-name', params.actorName);
      }
      if (params.notes) {
        args.push('--notes', params.notes);
      }
      if (params.sourceRunId) {
        args.push('--rerun-of-run-id', params.sourceRunId);
      }
      if (requestedCheckIds && requestedCheckIds.length > 0) {
        args.push('--checks', requestedCheckIds.join(','));
      }

      const execute = deps.executeGovernanceReport ?? ((executeArgs: string[]) => defaultExecuteGovernanceReport(executeArgs, cwd));
      void execute(args)
        .then(() => {
          operation.status = 'completed';
          operation.completed_at = new Date().toISOString();
        })
        .catch((error: unknown) => {
          operation.status = 'failed';
          operation.completed_at = new Date().toISOString();
          operation.error = error instanceof Error ? error.message : 'governance_runner_failed';
        })
        .finally(() => {
          currentOperation = undefined;
        });

      return operation;
    },
  };
}

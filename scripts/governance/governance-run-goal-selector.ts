export type GovernanceRunGoal = 'debug' | 'pr' | 'visual' | 'real' | 'release';

const GOVERNANCE_RUN_GOALS = ['debug', 'pr', 'visual', 'real', 'release'] as const satisfies readonly GovernanceRunGoal[];
const GOVERNANCE_RUN_GOAL_SET = new Set<string>(GOVERNANCE_RUN_GOALS);

const STANDALONE_QUICK_JOB_ID = 'standalone-gate-fast';
const STANDALONE_DEFAULT_JOB_ID = 'standalone-gate-default';
const STANDALONE_VISUAL_JOB_ID = 'standalone-lane-visual';
const STANDALONE_REAL_JOB_ID = 'standalone-lane-backend-real-core';

export function assertGovernanceRunGoal(goal: string): asserts goal is GovernanceRunGoal {
  if (!GOVERNANCE_RUN_GOAL_SET.has(goal)) {
    throw new Error(`unsupported governance run goal: ${goal}`);
  }
}

export function isReleaseGovernanceRunGoal(goal: GovernanceRunGoal): goal is 'release' {
  return goal === 'release';
}

export function selectGovernanceRunStandaloneJobIds(goal: Exclude<GovernanceRunGoal, 'release'>): readonly string[] {
  switch (goal) {
    case 'debug':
      return [STANDALONE_QUICK_JOB_ID];
    case 'visual':
      return [STANDALONE_QUICK_JOB_ID, STANDALONE_DEFAULT_JOB_ID, STANDALONE_VISUAL_JOB_ID];
    case 'real':
    case 'pr':
      return [STANDALONE_QUICK_JOB_ID, STANDALONE_DEFAULT_JOB_ID, STANDALONE_REAL_JOB_ID];
    default: {
      const exhaustive: never = goal;
      return exhaustive;
    }
  }
}

export const CURRENT_STORY_RISK_POLICY_SCHEMA = 'agentsmith_story_risk_policy/v1' as const;
export const CURRENT_STORY_RISK_POLICY_SOURCE = 'scripts/governance/current-story-risk-policy.ts' as const;
export const CURRENT_STORY_RISK_POLICY_INPUT_OVERRIDE_SOURCE = 'input_override_non_authoritative' as const;

export const STORY_RISK_POLICY_LEVEL_ORDER = ['V0', 'V1', 'V2', 'V3', 'V4'] as const;
export const STORY_RISK_POLICY_RISK_ORDER = ['R0', 'R1', 'R2', 'R3'] as const;

export type StoryRiskPolicyLevel = (typeof STORY_RISK_POLICY_LEVEL_ORDER)[number];
export type StoryRiskPolicyRisk = (typeof STORY_RISK_POLICY_RISK_ORDER)[number];
export type StoryRiskPolicySource =
  | typeof CURRENT_STORY_RISK_POLICY_SOURCE
  | typeof CURRENT_STORY_RISK_POLICY_INPUT_OVERRIDE_SOURCE;

export type StoryRiskPolicyRefDefinition = {
  riskFloor: StoryRiskPolicyRisk;
  levelFloor: readonly StoryRiskPolicyLevel[];
};

export const STORY_RISK_POLICY_REF_DEFINITIONS = {
  release_blocking_governance: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  identity_access_boundary: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  data_isolation_privacy: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  runtime_agent_control: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  file_continuity_integrity: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  audit_usage_billing: {
    riskFloor: 'R0',
    levelFloor: ['V0', 'V1', 'V2', 'V3'],
  },
  core_ai_workflow: {
    riskFloor: 'R1',
    levelFloor: ['V0', 'V1', 'V3'],
  },
  visual_product_experience: {
    riskFloor: 'R2',
    levelFloor: ['V0', 'V1', 'V2'],
  },
  standard_mock_workflow: {
    riskFloor: 'R2',
    levelFloor: ['V0', 'V1'],
  },
  low_risk_reference: {
    riskFloor: 'R3',
    levelFloor: ['V0'],
  },
} as const satisfies Record<string, StoryRiskPolicyRefDefinition>;

export type StoryRiskPolicyRefId = keyof typeof STORY_RISK_POLICY_REF_DEFINITIONS;

export type CurrentStoryRiskPolicyEntry = {
  policy_refs: readonly StoryRiskPolicyRefId[];
};

export type CurrentStoryRiskPolicyDocument = {
  schema: typeof CURRENT_STORY_RISK_POLICY_SCHEMA;
  stories: Record<string, CurrentStoryRiskPolicyEntry>;
};

export const CURRENT_STORY_RISK_POLICY = {
  schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
  stories: {
    'admin-switches-to-member-and-keeps-working': {
      policy_refs: ['identity_access_boundary'],
    },
    'ai-runtime-failure-and-recovery': {
      policy_refs: ['runtime_agent_control'],
    },
    'agent-task-artifact-to-files-download': {
      policy_refs: ['file_continuity_integrity'],
    },
    'agent-task-cancel-terminate-refresh-recovery': {
      policy_refs: ['runtime_agent_control'],
    },
    'agent-task-first-success': {
      policy_refs: ['core_ai_workflow'],
    },
    'agent-task-image-asset-savepoint-delete-restore': {
      policy_refs: ['file_continuity_integrity', 'runtime_agent_control'],
    },
    'agent-task-terminal-reentry-recovery': {
      policy_refs: ['runtime_agent_control'],
    },
    'agent-task-terminal-truth-unavailable-retry': {
      policy_refs: ['runtime_agent_control'],
    },
    'agent-task-terminal-workspace-multi-session': {
      policy_refs: ['runtime_agent_control'],
    },
    'api-key-to-endpoint-consumption': {
      policy_refs: ['identity_access_boundary', 'audit_usage_billing'],
    },
    'chat-agent-task-target-model-continuity': {
      policy_refs: ['runtime_agent_control'],
    },
    'chat-conversation-continuity': {
      policy_refs: ['core_ai_workflow'],
    },
    'chat-day-two-thread-workflow': {
      policy_refs: ['core_ai_workflow'],
    },
    'chat-stop-terminate-idempotent-state-resync': {
      policy_refs: ['runtime_agent_control'],
    },
    'files-crud-and-sync': {
      policy_refs: ['file_continuity_integrity'],
    },
    'files-library-access-and-recovery': {
      policy_refs: ['file_continuity_integrity'],
    },
    'governance-change-then-member-keeps-working': {
      policy_refs: ['release_blocking_governance'],
    },
    'invite-to-first-effective-work': {
      policy_refs: ['identity_access_boundary'],
    },
    'members-invite-and-chat-privacy': {
      policy_refs: ['identity_access_boundary', 'data_isolation_privacy'],
    },
    'membership-change-and-effective-access': {
      policy_refs: ['identity_access_boundary'],
    },
    'mock-lane-alerts-and-usage-review': {
      policy_refs: ['visual_product_experience', 'audit_usage_billing'],
    },
    'mock-lane-chat-operate-and-recover': {
      policy_refs: ['visual_product_experience', 'standard_mock_workflow'],
    },
    'mock-lane-connections-and-credentials-lifecycle': {
      policy_refs: ['visual_product_experience', 'identity_access_boundary'],
    },
    'mock-lane-entry-access': {
      policy_refs: ['visual_product_experience', 'identity_access_boundary'],
    },
    'mock-lane-governance-surfaces': {
      policy_refs: ['visual_product_experience', 'release_blocking_governance'],
    },
    'mock-lane-agent-task-lifecycle': {
      policy_refs: ['visual_product_experience', 'standard_mock_workflow'],
    },
    'mock-lane-self-service': {
      policy_refs: ['visual_product_experience', 'standard_mock_workflow'],
    },
    'mock-lane-settings-and-members-review': {
      policy_refs: ['visual_product_experience', 'identity_access_boundary'],
    },
    'mock-lane-workspace-project-core': {
      policy_refs: ['visual_product_experience', 'standard_mock_workflow'],
    },
    'personal-self-service-lifecycle': {
      policy_refs: ['data_isolation_privacy'],
    },
    'project-governance-onboarding': {
      policy_refs: ['release_blocking_governance'],
    },
    'project-governance-runtime-setup': {
      policy_refs: ['release_blocking_governance'],
    },
    'project-owner-daily-governance-review': {
      policy_refs: ['release_blocking_governance', 'audit_usage_billing'],
    },
    'project-surface-handoff-continuity': {
      policy_refs: ['core_ai_workflow'],
    },
    'provider-capacity-retry-error-ux': {
      policy_refs: ['runtime_agent_control'],
    },
    'real-backend-visual-review': {
      policy_refs: ['visual_product_experience', 'core_ai_workflow'],
    },
    'release-user-story-end-to-end': {
      policy_refs: ['release_blocking_governance'],
    },
    'resource-policy-change-to-observable-effect': {
      policy_refs: ['release_blocking_governance'],
    },
    'system-admin-entry': {
      policy_refs: ['identity_access_boundary'],
    },
    'system-admin-multi-workspace-handoff': {
      policy_refs: ['identity_access_boundary'],
    },
    'unicode-filename-round-trip': {
      policy_refs: ['file_continuity_integrity'],
    },
    'usage-self-scope-review': {
      policy_refs: ['audit_usage_billing'],
    },
    'use-guide-first-consumption': {
      policy_refs: ['low_risk_reference'],
    },
    'workspace-admin-boundary-and-project-creator': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-connections-to-project-use': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-entry-and-project-discovery': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-identity-switch-truth': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-idp-and-admin-handoff': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-lifecycle-admin-operations': {
      policy_refs: ['release_blocking_governance'],
    },
    'workspace-project-personal-context': {
      policy_refs: ['data_isolation_privacy'],
    },
    'workspace-public-entry-and-login-truth': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-publish-to-usable-access': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-settings-save-and-effect': {
      policy_refs: ['identity_access_boundary'],
    },
    'workspace-shared-context-continuity': {
      policy_refs: ['data_isolation_privacy'],
    },
  },
} as const satisfies CurrentStoryRiskPolicyDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertExactRootShape(policy: Record<string, unknown>): void {
  const keys = sorted(Object.keys(policy));
  if (keys.length !== 2 || keys[0] !== 'schema' || keys[1] !== 'stories') {
    throw new Error('current story risk policy must only contain schema and stories');
  }
}

function assertKnownPolicyRef(storyId: string, ref: string): asserts ref is StoryRiskPolicyRefId {
  if (!Object.prototype.hasOwnProperty.call(STORY_RISK_POLICY_REF_DEFINITIONS, ref)) {
    throw new Error(`story ${storyId} has unknown policy ref: ${ref}`);
  }
}

export function validateCurrentStoryRiskPolicy(
  policy: unknown,
  canonicalStoryIds: readonly string[],
): CurrentStoryRiskPolicyDocument {
  if (!isRecord(policy)) {
    throw new Error('current story risk policy must be an object');
  }
  assertExactRootShape(policy);
  if (policy.schema !== CURRENT_STORY_RISK_POLICY_SCHEMA) {
    throw new Error(`current story risk policy schema must be ${CURRENT_STORY_RISK_POLICY_SCHEMA}`);
  }
  if (!isRecord(policy.stories)) {
    throw new Error('current story risk policy stories must be an object keyed by story id');
  }

  const canonicalIds = sorted(canonicalStoryIds);
  const canonicalIdSet = new Set(canonicalIds);
  if (canonicalIdSet.size !== canonicalIds.length) {
    throw new Error('canonical story ids must be unique before validating current story risk policy');
  }

  const policyStoryIds = sorted(Object.keys(policy.stories));
  const policyStoryIdSet = new Set(policyStoryIds);
  const missingStoryIds = canonicalIds.filter((storyId) => !policyStoryIdSet.has(storyId));
  const unknownStoryIds = policyStoryIds.filter((storyId) => !canonicalIdSet.has(storyId));
  if (missingStoryIds.length > 0) {
    throw new Error(`current story risk policy missing canonical story ids: ${missingStoryIds.join(', ')}`);
  }
  if (unknownStoryIds.length > 0) {
    throw new Error(`current story risk policy has unknown story ids: ${unknownStoryIds.join(', ')}`);
  }

  const stories: Record<string, CurrentStoryRiskPolicyEntry> = {};
  for (const storyId of policyStoryIds) {
    const entry = policy.stories[storyId];
    if (!isRecord(entry)) {
      throw new Error(`story ${storyId} risk policy entry must be an object`);
    }
    const entryKeys = Object.keys(entry);
    if (entryKeys.length !== 1 || entryKeys[0] !== 'policy_refs') {
      throw new Error(`story ${storyId} risk policy entry may only contain policy_refs`);
    }
    if (!Array.isArray(entry.policy_refs)) {
      throw new Error(`story ${storyId} risk policy_refs must be an array`);
    }
    if (entry.policy_refs.length === 0) {
      throw new Error(`story ${storyId} risk policy_refs must not be empty`);
    }
    const refs: StoryRiskPolicyRefId[] = [];
    const seenRefs = new Set<string>();
    for (const ref of entry.policy_refs) {
      if (typeof ref !== 'string') {
        throw new Error(`story ${storyId} policy ref must be a string`);
      }
      if (!ref.trim()) {
        throw new Error(`story ${storyId} has empty policy ref`);
      }
      if (ref !== ref.trim()) {
        throw new Error(`story ${storyId} policy ref must not contain surrounding whitespace: ${ref}`);
      }
      assertKnownPolicyRef(storyId, ref);
      if (seenRefs.has(ref)) {
        throw new Error(`story ${storyId} has duplicate policy ref: ${ref}`);
      }
      seenRefs.add(ref);
      refs.push(ref);
    }
    stories[storyId] = {
      policy_refs: refs,
    };
  }

  return {
    schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
    stories,
  };
}

export function resolveStoryRiskPolicyFloor(policyRefs: readonly StoryRiskPolicyRefId[]): {
  riskFloor: StoryRiskPolicyRisk;
  levelFloor: readonly StoryRiskPolicyLevel[];
} {
  let riskFloor: StoryRiskPolicyRisk = 'R3';
  const levels = new Set<StoryRiskPolicyLevel>();
  for (const policyRef of policyRefs) {
    const definition = STORY_RISK_POLICY_REF_DEFINITIONS[policyRef];
    if (
      STORY_RISK_POLICY_RISK_ORDER.indexOf(definition.riskFloor)
      < STORY_RISK_POLICY_RISK_ORDER.indexOf(riskFloor)
    ) {
      riskFloor = definition.riskFloor;
    }
    for (const level of definition.levelFloor) {
      levels.add(level);
    }
  }

  return {
    riskFloor,
    levelFloor: STORY_RISK_POLICY_LEVEL_ORDER.filter((level) => levels.has(level)),
  };
}

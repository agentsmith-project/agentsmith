import type {
  AgentRunnerActions,
  AgentRunnerKind,
  AgentRunnerServiceKey,
  AgentRunnerStatus,
  AgentRunnerTestConnectionResponse,
} from '@/lib/api/types';

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export type AgentRunnerKeysSheetStateId =
  | 'system_managed_read_only'
  | 'no_active_key'
  | 'key_issued_secret_shown_once'
  | 'waiting_for_connection'
  | 'connected_fresh'
  | 'connection_stale'
  | 'disconnected'
  | 'test_connection_warning'
  | 'test_connection_failed'
  | 'actions_disabled';

export type AgentRunnerKeysActionName =
  | 'issueKey'
  | 'revokeKey'
  | 'testConnection'
  | 'runTestTask';

export interface AgentRunnerKeysActionState {
  visible: boolean;
  allowed: boolean;
  enabled: boolean;
  reasonCode?: string;
  disabledReasonKey?: 'sheet_state_reason_action_disabled';
}

export type AgentRunnerUnavailableKeyStatus = 'revoked' | 'expired';

export interface AgentRunnerUnavailableKey {
  key: AgentRunnerServiceKey;
  status: AgentRunnerUnavailableKeyStatus;
}

export interface AgentRunnerKeysSheetState {
  id: AgentRunnerKeysSheetStateId;
  titleKey: string;
  descriptionKey: string;
  badgeStatus: 'info' | 'success' | 'warning' | 'error' | 'blocked';
  activeKeys: AgentRunnerServiceKey[];
  unavailableKeys: AgentRunnerUnavailableKey[];
  isDeveloperConnection: boolean;
  hasFreshConnectedCheck: boolean;
  disabledReasonKey?: 'sheet_state_reason_action_disabled';
  actionStates: Record<AgentRunnerKeysActionName, AgentRunnerKeysActionState>;
}

interface DeriveAgentRunnerKeysSheetStateInput {
  runnerKind: AgentRunnerKind;
  readOnly: boolean;
  runnerStatus: AgentRunnerStatus;
  actions: AgentRunnerActions;
  keys: AgentRunnerServiceKey[];
  keyIssuedSecretVisible: boolean;
  testConnectionResult: AgentRunnerTestConnectionResponse | null;
  testConnectionFailed: boolean;
  createPending: boolean;
  revokePending: boolean;
  testConnectionPending: boolean;
  testTaskPending: boolean;
}

type AgentRunnerConnectionOperation =
  | 'issue_connection_key'
  | 'revoke_connection_key'
  | 'test_connection'
  | 'run_test_task';

const ACTION_OPERATION_BY_NAME: Record<AgentRunnerKeysActionName, AgentRunnerConnectionOperation> = {
  issueKey: 'issue_connection_key',
  revokeKey: 'revoke_connection_key',
  testConnection: 'test_connection',
  runTestTask: 'run_test_task',
};

const ACTION_PENDING_BY_NAME = {
  issueKey: 'createPending',
  revokeKey: 'revokePending',
  testConnection: 'testConnectionPending',
  runTestTask: 'testTaskPending',
} as const satisfies Record<AgentRunnerKeysActionName, keyof Pick<
  DeriveAgentRunnerKeysSheetStateInput,
  'createPending' | 'revokePending' | 'testConnectionPending' | 'testTaskPending'
>>;

function keyExpiredAtRuntime(key: AgentRunnerServiceKey): boolean {
  if (!key.expires_at) return false;
  const expiresAt = new Date(key.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function getUnavailableKeyStatus(key: AgentRunnerServiceKey): AgentRunnerUnavailableKeyStatus | null {
  if (key.status === 'revoked') return 'revoked';
  if (key.status === 'expired') return 'expired';
  if (key.status === 'active' && keyExpiredAtRuntime(key)) return 'expired';
  return null;
}

function keyCreatedAtMs(key: AgentRunnerServiceKey): number {
  const timestamp = Date.parse(key.created_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectCurrentActiveConnectionKey(keys: AgentRunnerServiceKey[]): AgentRunnerServiceKey | null {
  const activeKeys = keys.filter((key) => key.status === 'active' && !keyExpiredAtRuntime(key));
  if (activeKeys.length === 0) return null;
  return [...activeKeys].sort((a, b) => {
    const createdAtDiff = keyCreatedAtMs(b) - keyCreatedAtMs(a);
    return createdAtDiff !== 0 ? createdAtDiff : b.id.localeCompare(a.id);
  })[0] ?? null;
}

function getActionState(
  name: AgentRunnerKeysActionName,
  input: DeriveAgentRunnerKeysSheetStateInput,
  isDeveloperConnection: boolean,
  activeKeyCount: number,
  hasFreshConnectedCheck: boolean,
): AgentRunnerKeysActionState {
  const operation = ACTION_OPERATION_BY_NAME[name];
  const affordance = input.actions[operation];
  const keyAlreadyIssuedForDailyUi = name === 'issueKey'
    && (activeKeyCount > 0 || input.keyIssuedSecretVisible);
  const visible = isDeveloperConnection
    && affordance?.visible === true
    && !keyAlreadyIssuedForDailyUi;
  const allowed = affordance?.allowed === true;
  const pending = input[ACTION_PENDING_BY_NAME[name]];
  const baseEnabled = visible && allowed && !pending;
  const needsActiveKey = name === 'revokeKey' || name === 'testConnection';
  const needsFreshCheck = name === 'runTestTask';
  const enabled = baseEnabled
    && (!needsActiveKey || activeKeyCount > 0)
    && (!needsFreshCheck || hasFreshConnectedCheck);
  const disabledReasonKey = visible && !allowed ? 'sheet_state_reason_action_disabled' : undefined;

  return {
    visible,
    allowed,
    enabled,
    ...(affordance?.reason_code ? { reasonCode: affordance.reason_code } : {}),
    ...(disabledReasonKey ? { disabledReasonKey } : {}),
  };
}

function getFreshConnectedCheck(result: AgentRunnerTestConnectionResponse | null): boolean {
  return result?.status === 'connected'
    && result.freshness.state === 'fresh'
    && result.freshness.active_connection_count > 0;
}

function testConnectionHasWarning(result: AgentRunnerTestConnectionResponse | null): boolean {
  if (!result || !getFreshConnectedCheck(result)) return false;
  return result.capabilities.task_execution === false || result.errors.length > 0;
}

function deriveStateId({
  input,
  isDeveloperConnection,
  activeKeyCount,
  hasFreshConnectedCheck,
  allVisibleActionsDenied,
}: {
  input: DeriveAgentRunnerKeysSheetStateInput;
  isDeveloperConnection: boolean;
  activeKeyCount: number;
  hasFreshConnectedCheck: boolean;
  allVisibleActionsDenied: boolean;
}): AgentRunnerKeysSheetStateId {
  if (!isDeveloperConnection) return 'system_managed_read_only';
  if (allVisibleActionsDenied) return 'actions_disabled';
  if (input.keyIssuedSecretVisible) return 'key_issued_secret_shown_once';
  if (activeKeyCount === 0) return 'no_active_key';
  if (input.testConnectionFailed) return 'test_connection_failed';

  const result = input.testConnectionResult;
  if (!result) {
    return input.runnerStatus === 'offline' || input.runnerStatus === 'draft'
      ? 'disconnected'
      : 'waiting_for_connection';
  }
  if (result.status === 'stale' || result.freshness.state === 'stale') return 'connection_stale';
  if (
    result.status === 'disconnected'
    || result.freshness.state === 'missing'
    || result.freshness.active_connection_count <= 0
  ) {
    return 'disconnected';
  }
  if (testConnectionHasWarning(result)) return 'test_connection_warning';
  if (hasFreshConnectedCheck) return 'connected_fresh';
  return 'test_connection_warning';
}

function getStateBadgeStatus(id: AgentRunnerKeysSheetStateId): AgentRunnerKeysSheetState['badgeStatus'] {
  switch (id) {
    case 'connected_fresh':
      return 'success';
    case 'connection_stale':
    case 'test_connection_warning':
    case 'key_issued_secret_shown_once':
    case 'waiting_for_connection':
      return 'warning';
    case 'disconnected':
    case 'test_connection_failed':
    case 'actions_disabled':
      return 'error';
    case 'system_managed_read_only':
    case 'no_active_key':
      return 'info';
  }
}

export function deriveAgentRunnerKeysSheetState(
  input: DeriveAgentRunnerKeysSheetStateInput,
): AgentRunnerKeysSheetState {
  const isDeveloperConnection = input.runnerKind === 'developer' && !input.readOnly;
  const currentActiveKey = selectCurrentActiveConnectionKey(input.keys);
  const activeKeys = currentActiveKey ? [currentActiveKey] : [];
  const unavailableKeys = input.keys
    .map((key): AgentRunnerUnavailableKey | null => {
      const status = getUnavailableKeyStatus(key);
      return status ? { key, status } : null;
    })
    .filter((item): item is AgentRunnerUnavailableKey => item !== null);
  const hasFreshConnectedCheck = getFreshConnectedCheck(input.testConnectionResult);
  const visibleConnectionOperations = (Object.values(ACTION_OPERATION_BY_NAME) as AgentRunnerConnectionOperation[])
    .filter((operation) => input.actions[operation]?.visible === true);
  const hasVisibleDeniedAction = isDeveloperConnection
    && visibleConnectionOperations.some((operation) => input.actions[operation]?.allowed !== true);
  const allVisibleActionsDenied = isDeveloperConnection
    && visibleConnectionOperations.length > 0
    && visibleConnectionOperations.every((operation) => input.actions[operation]?.allowed !== true);
  const id = deriveStateId({
    input,
    isDeveloperConnection,
    activeKeyCount: activeKeys.length,
    hasFreshConnectedCheck,
    allVisibleActionsDenied,
  });
  const actionStates = {
    issueKey: getActionState('issueKey', input, isDeveloperConnection, activeKeys.length, hasFreshConnectedCheck),
    revokeKey: getActionState('revokeKey', input, isDeveloperConnection, activeKeys.length, hasFreshConnectedCheck),
    testConnection: getActionState('testConnection', input, isDeveloperConnection, activeKeys.length, hasFreshConnectedCheck),
    runTestTask: getActionState('runTestTask', input, isDeveloperConnection, activeKeys.length, hasFreshConnectedCheck),
  };

  return {
    id,
    titleKey: `sheet_state_${id}_title`,
    descriptionKey: `sheet_state_${id}_description`,
    badgeStatus: getStateBadgeStatus(id),
    activeKeys,
    unavailableKeys,
    isDeveloperConnection,
    hasFreshConnectedCheck,
    ...(hasVisibleDeniedAction ? { disabledReasonKey: 'sheet_state_reason_action_disabled' } : {}),
    actionStates,
  };
}

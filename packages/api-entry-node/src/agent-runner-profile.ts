import type { AgentRecord, AgentRunnerProviderKind } from './resource-models.js';

type AgentRunnerProfileInput = (
  Pick<AgentRecord, 'runner_provider'>
) | null | undefined;

type AgentRunnerRuntime = 'dev_direct' | 'docker_manual' | 'compose_managed' | 'k8s_internal';

function isLoopbackLikeHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function resolveImplicitExternalRuntime(): Extract<AgentRunnerRuntime, 'dev_direct' | 'docker_manual'> {
  const rawBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL?.trim();
  if (!rawBase) return 'docker_manual';
  try {
    const parsed = new URL(rawBase);
    return isLoopbackLikeHost(parsed.hostname) ? 'dev_direct' : 'docker_manual';
  } catch {
    return 'docker_manual';
  }
}

export function resolveAgentRunnerRuntime(agent: AgentRunnerProfileInput): AgentRunnerRuntime {
  if (isManagedAgentRunner(agent)) return 'k8s_internal';
  return resolveImplicitExternalRuntime();
}

export function isComposeManagedExternalAgent(agent: AgentRunnerProfileInput): boolean {
  return isDeveloperAgentRunner(agent) && resolveAgentRunnerRuntime(agent) === 'compose_managed';
}

export function usesAgentPresenceScopedNotebookRunner(agent: AgentRunnerProfileInput): boolean {
  return usesAgentPresenceScopedTaskRunner(agent);
}

export function isExternalRunnerRuntime(
  agent: AgentRunnerProfileInput,
  runtime: Extract<AgentRunnerRuntime, 'dev_direct' | 'docker_manual' | 'compose_managed'>,
): boolean {
  return isDeveloperAgentRunner(agent) && resolveAgentRunnerRuntime(agent) === runtime;
}

export function resolveAgentRunnerProviderKind(agent: AgentRunnerProfileInput): AgentRunnerProviderKind {
  if (agent?.runner_provider === 'developer' || agent?.runner_provider === 'managed') {
    return agent.runner_provider;
  }
  return 'managed';
}

export function isManagedAgentRunner(agent: AgentRunnerProfileInput): boolean {
  return resolveAgentRunnerProviderKind(agent) === 'managed';
}

export function isDeveloperAgentRunner(agent: AgentRunnerProfileInput): boolean {
  return resolveAgentRunnerProviderKind(agent) === 'developer';
}

export function usesAgentPresenceScopedTaskRunner(agent: AgentRunnerProfileInput): boolean {
  return isDeveloperAgentRunner(agent);
}

export function usesInternalApiBaseForTaskRunner(agent: AgentRunnerProfileInput): boolean {
  return isManagedAgentRunner(agent);
}

import { asRecord } from './manifest';
import {
  componentLabel,
  resourceKind,
  splitKubernetesDocuments,
  type KubernetesDocument,
} from './kubernetes';

export const AFSCP_SCHEMA_BOOTSTRAP_JOB = 'afscp-schema-bootstrap';
export const AFSCP_VOLUME_BOOTSTRAP_JOB = 'afscp-volume-bootstrap';
export const AFSCP_BOOTSTRAP_JOB_NAMES = [
  AFSCP_SCHEMA_BOOTSTRAP_JOB,
  AFSCP_VOLUME_BOOTSTRAP_JOB,
] as const;

export type AfscpBootstrapJobName = typeof AFSCP_BOOTSTRAP_JOB_NAMES[number];

export type AfscpBootstrapJobStatus = {
  state: 'complete' | 'failed' | 'pending';
  reason?: string;
  message?: string;
  active?: number;
  succeeded?: number;
  failed?: number;
};

function isTrueCondition(condition: Record<string, unknown>, type: string): boolean {
  return condition.type === type && condition.status === 'True';
}

function numericStatus(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function summarizeKubernetesJobStatus(job: Record<string, unknown>): AfscpBootstrapJobStatus {
  const status = asRecord(job.status);
  const conditions = Array.isArray(status.conditions) ? status.conditions.map(asRecord) : [];
  const failedCondition = conditions.find((condition) => isTrueCondition(condition, 'Failed'));
  const completeCondition = conditions.find((condition) => isTrueCondition(condition, 'Complete'));

  if (failedCondition) {
    return {
      state: 'failed',
      reason: typeof failedCondition.reason === 'string' ? failedCondition.reason : undefined,
      message: typeof failedCondition.message === 'string' ? failedCondition.message : undefined,
      active: numericStatus(status.active),
      succeeded: numericStatus(status.succeeded),
      failed: numericStatus(status.failed),
    };
  }

  if (completeCondition) {
    return {
      state: 'complete',
      reason: typeof completeCondition.reason === 'string' ? completeCondition.reason : undefined,
      message: typeof completeCondition.message === 'string' ? completeCondition.message : undefined,
      active: numericStatus(status.active),
      succeeded: numericStatus(status.succeeded),
      failed: numericStatus(status.failed),
    };
  }

  return {
    state: 'pending',
    active: numericStatus(status.active),
    succeeded: numericStatus(status.succeeded),
    failed: numericStatus(status.failed),
  };
}

function isAfscpBootstrapJob(document: KubernetesDocument): boolean {
  const name = asRecord(document.metadata).name;

  return resourceKind(document) === 'Job'
    && typeof name === 'string'
    && AFSCP_BOOTSTRAP_JOB_NAMES.includes(name as AfscpBootstrapJobName);
}

function isAfscpBootstrapPrerequisite(document: KubernetesDocument): boolean {
  return componentLabel(document) === 'afscp-runtime'
    && ['ServiceAccount', 'ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim'].includes(resourceKind(document));
}

export function splitAfscpBootstrapAppYaml(source: string): { bootstrapYaml: string; remainingYaml: string } {
  const split = splitKubernetesDocuments(source, (document) =>
    isAfscpBootstrapJob(document) || isAfscpBootstrapPrerequisite(document),
  );

  return {
    bootstrapYaml: split.firstYaml,
    remainingYaml: split.secondYaml,
  };
}

import type { AfscpResourceKind } from './afscp-error-mapper.js';
import {
  isProjectAfscpOwnedResourceKind,
  type ProjectAfscpNamespaceStore,
  type ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';

export type AfscpOwnershipGuardResult =
  | { ok: true; namespaceId: string }
  | { ok: false; code: 'not_found'; message: 'not_found' };

export interface VerifyAfscpNamespaceOwnershipInput {
  workspaceId: string;
  projectId: string;
  namespaceId: string;
}

export interface VerifyAfscpResourceOwnershipInput {
  workspaceId: string;
  projectId: string;
  resourceKind: AfscpResourceKind;
  resourceId: string;
}

export interface AfscpResourceOwnershipGuardPort {
  readonly enabled: boolean;
  verifyReadyNamespace(input: VerifyAfscpNamespaceOwnershipInput): Promise<AfscpOwnershipGuardResult>;
  verifyNamespaceOwnership(input: VerifyAfscpNamespaceOwnershipInput): Promise<AfscpOwnershipGuardResult>;
  verifyResourceOwnership(input: VerifyAfscpResourceOwnershipInput): Promise<AfscpOwnershipGuardResult>;
}

const NOT_FOUND: AfscpOwnershipGuardResult = {
  ok: false,
  code: 'not_found',
  message: 'not_found',
};

class DisabledAfscpResourceOwnershipGuard implements AfscpResourceOwnershipGuardPort {
  readonly enabled = false;

  async verifyReadyNamespace(): Promise<AfscpOwnershipGuardResult> {
    return NOT_FOUND;
  }

  async verifyNamespaceOwnership(): Promise<AfscpOwnershipGuardResult> {
    return NOT_FOUND;
  }

  async verifyResourceOwnership(): Promise<AfscpOwnershipGuardResult> {
    return NOT_FOUND;
  }
}

export class AfscpResourceOwnershipGuard implements AfscpResourceOwnershipGuardPort {
  readonly enabled = true;

  static disabled(): AfscpResourceOwnershipGuardPort {
    return new DisabledAfscpResourceOwnershipGuard();
  }

  constructor(
    private readonly namespaceStore: ProjectAfscpNamespaceStore,
    private readonly resourceOwnershipStore: ProjectAfscpResourceOwnershipStore,
  ) {}

  async verifyReadyNamespace(input: VerifyAfscpNamespaceOwnershipInput): Promise<AfscpOwnershipGuardResult> {
    const mapping = await this.namespaceStore.getProjectNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    if (
      !mapping
      || mapping.namespace_id !== input.namespaceId
      || mapping.status !== 'ready'
      || mapping.stage !== 'ready'
      || mapping.next_action !== 'none'
    ) {
      return NOT_FOUND;
    }
    return {
      ok: true,
      namespaceId: mapping.namespace_id,
    };
  }

  async verifyNamespaceOwnership(input: VerifyAfscpNamespaceOwnershipInput): Promise<AfscpOwnershipGuardResult> {
    return this.verifyReadyNamespace(input);
  }

  async verifyResourceOwnership(input: VerifyAfscpResourceOwnershipInput): Promise<AfscpOwnershipGuardResult> {
    if (input.resourceKind === 'namespace') {
      return this.verifyReadyNamespace({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        namespaceId: input.resourceId,
      });
    }

    if (!isProjectAfscpOwnedResourceKind(input.resourceKind)) {
      return NOT_FOUND;
    }

    const mapping = await this.resourceOwnershipStore.getResourceOwnership({
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
    });
    if (
      !mapping
      || mapping.workspace_id !== input.workspaceId
      || mapping.project_id !== input.projectId
    ) {
      return NOT_FOUND;
    }

    return this.verifyReadyNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
    });
  }
}

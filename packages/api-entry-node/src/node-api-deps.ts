import type {
  CreateProjectUseCase,
  DeleteProjectUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  UpdateProjectUseCase,
} from '@mbos/application';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { ChatResourceService } from './chat-resource-service.js';
import type { EndpointResourceService } from './endpoint-resource-service.js';
import type { AgentResourceService } from './agent-resource-service.js';
import type { AgentExecutionService } from './agent-execution-service.js';
import type { InternalAgentPodManager } from './internal-agent-pod-manager.js';
import type { InternalAgentWorkspaceBindingManager, InternalAgentWorkspaceProvisioner } from './internal-agent-workspace-provisioner.js';
import type { GovernanceRunnerController } from './governance-runner.js';
import type { UniversalProxyService } from './universal-proxy-service.js';
import type { NotebookTerminalService } from './notebook-terminal-service.js';
import type { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { ProjectAfscpNamespaceStore } from './project-afscp-namespace-store.js';
import type { ProjectStorageBootstrapServicePort } from './project-storage-bootstrap-service.js';
import type { ProjectStorageLifecycleServicePort } from './project-storage-lifecycle-service.js';
import type { AfscpResourceOwnershipGuardPort } from './afscp-resource-ownership-guard.js';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';

export interface NodeApiDeps {
  governanceReportsDir?: string;
  governanceRunsDir?: string;
  governanceIncidentsDir?: string;
  cache: CachePort;
  docStore: JsonDocStorePort;
  chatResourceService: ChatResourceService;
  endpointResourceService: EndpointResourceService;
  agentResourceService: AgentResourceService;
  agentExecutionService: AgentExecutionService;
  notebookTerminalService: NotebookTerminalService;
  internalAgentPodManager?: InternalAgentPodManager;
  internalWorkloadCoordinator?: InternalWorkloadCoordinator;
  internalAgentWorkspaceBindingManager?: InternalAgentWorkspaceBindingManager;
  /** @deprecated use internalAgentWorkspaceBindingManager */
  internalAgentWorkspaceProvisioner?: InternalAgentWorkspaceProvisioner;
  projectAfscpNamespaceStore?: ProjectAfscpNamespaceStore;
  projectStorageBootstrapService: ProjectStorageBootstrapServicePort;
  projectStorageLifecycleService: ProjectStorageLifecycleServicePort;
  afscpResourceOwnershipGuard: AfscpResourceOwnershipGuardPort;
  fileLibraryStorageAdapter?: FileLibraryStoragePort;
  createProjectUseCase: CreateProjectUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  governanceRunner?: GovernanceRunnerController;
  universalProxyService?: UniversalProxyService;
}

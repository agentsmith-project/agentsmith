import type {
  CreateFileLibraryFolderUseCase,
  CreateFileLibraryObjectShareLinkUseCase,
  CreateProjectUseCase,
  CreateFileLibraryCatalogUseCase,
  DeleteFileLibraryObjectsUseCase,
  DeleteProjectUseCase,
  DeleteFileLibraryCatalogUseCase,
  DownloadFileLibraryObjectUseCase,
  GetProjectUseCase,
  GetFileLibraryObjectMetaUseCase,
  ListProjectsUseCase,
  ListFileLibraryObjectsUseCase,
  ListFileLibraryCatalogsUseCase,
  MoveFileLibraryObjectUseCase,
  UploadFileLibraryObjectUseCase,
  UpdateProjectUseCase,
  UpdateFileLibraryCatalogUseCase,
} from '@mbos/application';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { ChatResourceService } from './chat-resource-service.js';
import type { EndpointResourceService } from './endpoint-resource-service.js';
import type { AgentResourceService } from './agent-resource-service.js';
import type { AgentExecutionService } from './agent-execution-service.js';
import type { InternalAgentPodManager } from './internal-agent-pod-manager.js';
import type { InternalAgentWorkspaceBindingManager, InternalAgentWorkspaceProvisioner } from './internal-agent-workspace-provisioner.js';
import type { GovernanceRunnerController } from './governance-runner.js';
import type { FileLibraryOrchestrator } from './file-library-orchestrator.js';
import type { FileLibraryGatewayManager } from './file-library-gateway-manager.js';

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
  internalAgentPodManager?: InternalAgentPodManager;
  internalAgentWorkspaceBindingManager?: InternalAgentWorkspaceBindingManager;
  /** @deprecated use internalAgentWorkspaceBindingManager */
  internalAgentWorkspaceProvisioner?: InternalAgentWorkspaceProvisioner;
  fileLibraryBucket: string;
  createFileLibraryCatalogUseCase: CreateFileLibraryCatalogUseCase;
  createFileLibraryFolderUseCase: CreateFileLibraryFolderUseCase;
  createFileLibraryObjectShareLinkUseCase: CreateFileLibraryObjectShareLinkUseCase;
  createProjectUseCase: CreateProjectUseCase;
  uploadFileLibraryObjectUseCase: UploadFileLibraryObjectUseCase;
  deleteFileLibraryCatalogUseCase: DeleteFileLibraryCatalogUseCase;
  deleteFileLibraryObjectsUseCase: DeleteFileLibraryObjectsUseCase;
  moveFileLibraryObjectUseCase: MoveFileLibraryObjectUseCase;
  downloadFileLibraryObjectUseCase: DownloadFileLibraryObjectUseCase;
  getFileLibraryObjectMetaUseCase: GetFileLibraryObjectMetaUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listFileLibraryCatalogsUseCase: ListFileLibraryCatalogsUseCase;
  listFileLibraryObjectsUseCase: ListFileLibraryObjectsUseCase;
  updateFileLibraryCatalogUseCase: UpdateFileLibraryCatalogUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  governanceRunner?: GovernanceRunnerController;
  fileLibraryOrchestrator?: FileLibraryOrchestrator;
  fileLibraryGatewayManager?: FileLibraryGatewayManager;
}

import type {
  CreateSourceFolderUseCase,
  CreateSourceObjectShareLinkUseCase,
  CreateProjectUseCase,
  CreateSourceLibraryUseCase,
  CreateSourceUseCase,
  DeleteSourceObjectsUseCase,
  DeleteProjectUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DownloadSourceObjectUseCase,
  DownloadSourceUseCase,
  GetProjectUseCase,
  GetSourceObjectMetaUseCase,
  GetSourceUseCase,
  GetSourcesLimitUseCase,
  ListProjectsUseCase,
  ListSourceLibraryObjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  MoveSourceObjectUseCase,
  UploadSourceObjectUseCase,
  UpdateProjectUseCase,
  UpdateSourceLibraryUseCase,
} from '@mbos/application';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { ChatResourceService } from './chat-resource-service.js';
import type { EndpointResourceService } from './endpoint-resource-service.js';
import type { AgentResourceService } from './agent-resource-service.js';
import type { AgentExecutionService } from './agent-execution-service.js';
import type { InternalAgentPodManager } from './internal-agent-pod-manager.js';
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
  sourceBucket: string;
  createSourceLibraryUseCase: CreateSourceLibraryUseCase;
  createSourceFolderUseCase: CreateSourceFolderUseCase;
  createSourceObjectShareLinkUseCase: CreateSourceObjectShareLinkUseCase;
  createProjectUseCase: CreateProjectUseCase;
  createSourceUseCase: CreateSourceUseCase;
  uploadSourceObjectUseCase: UploadSourceObjectUseCase;
  deleteSourceLibraryUseCase: DeleteSourceLibraryUseCase;
  deleteSourceObjectsUseCase: DeleteSourceObjectsUseCase;
  deleteSourceUseCase: DeleteSourceUseCase;
  moveSourceObjectUseCase: MoveSourceObjectUseCase;
  downloadSourceObjectUseCase: DownloadSourceObjectUseCase;
  downloadSourceUseCase: DownloadSourceUseCase;
  getSourceObjectMetaUseCase: GetSourceObjectMetaUseCase;
  getSourceUseCase: GetSourceUseCase;
  getSourcesLimitUseCase: GetSourcesLimitUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listSourceLibrariesUseCase: ListSourceLibrariesUseCase;
  listSourceLibraryObjectsUseCase: ListSourceLibraryObjectsUseCase;
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  governanceRunner?: GovernanceRunnerController;
  fileLibraryOrchestrator?: FileLibraryOrchestrator;
  fileLibraryGatewayManager?: FileLibraryGatewayManager;
}

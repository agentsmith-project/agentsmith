import type {
  BatchCancelSourceAIReadyUseCase,
  BatchStartSourceAIReadyUseCase,
  CancelAIReadyJobUseCase,
  CancelSourceAIReadyUseCase,
  CreateSourceFolderUseCase,
  CreateSourceObjectShareLinkUseCase,
  CreateAIReadyJobUseCase,
  CreateProjectUseCase,
  CreateSourceLibraryUseCase,
  CreateSourceUseCase,
  DeleteSourceObjectsUseCase,
  DeleteProjectUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DownloadSourceObjectUseCase,
  DownloadSourceUseCase,
  GetAIReadyJobUseCase,
  GetProjectUseCase,
  GetSourceObjectMetaUseCase,
  GetSourceUseCase,
  GetSourcesQuotaUseCase,
  ListProjectsUseCase,
  ListSourceLibraryObjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  MoveSourceObjectUseCase,
  RetrySourceAIReadyUseCase,
  RunQueuedAIReadyJobUseCase,
  StartSourceAIReadyUseCase,
  UploadSourceObjectUseCase,
  UpdateProjectUseCase,
  UpdateSourceLibraryUseCase,
} from '@mbos/application';
import type { InMemoryJobQueue } from '@mbos/adapters-private';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { ChatResourceService } from './chat-resource-service.js';
import type { EndpointResourceService } from './endpoint-resource-service.js';
import type { AgentResourceService } from './agent-resource-service.js';
import type { AgentRuntimeService } from './agent-runtime-service.js';
import type { UsageReportRunnerController } from './usage-report-runner.js';
import type { ReleaseGateRunnerController } from './release-gate-runner.js';

export interface NodeApiDeps {
  releaseReportsDir?: string;
  releaseRunsDir?: string;
  releaseEscalationsDir?: string;
  cache: CachePort;
  docStore: JsonDocStorePort;
  chatResourceService: ChatResourceService;
  endpointResourceService: EndpointResourceService;
  agentResourceService: AgentResourceService;
  agentRuntimeService: AgentRuntimeService;
  sourceBucket: string;
  aiReadyJobQueue: InMemoryJobQueue;
  createAIReadyJobUseCase: CreateAIReadyJobUseCase;
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
  getAIReadyJobUseCase: GetAIReadyJobUseCase;
  getSourcesQuotaUseCase: GetSourcesQuotaUseCase;
  startSourceAIReadyUseCase: StartSourceAIReadyUseCase;
  cancelSourceAIReadyUseCase: CancelSourceAIReadyUseCase;
  retrySourceAIReadyUseCase: RetrySourceAIReadyUseCase;
  batchStartSourceAIReadyUseCase: BatchStartSourceAIReadyUseCase;
  batchCancelSourceAIReadyUseCase: BatchCancelSourceAIReadyUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listSourceLibrariesUseCase: ListSourceLibrariesUseCase;
  listSourceLibraryObjectsUseCase: ListSourceLibraryObjectsUseCase;
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  cancelAIReadyJobUseCase: CancelAIReadyJobUseCase;
  runQueuedAIReadyJobUseCase: RunQueuedAIReadyJobUseCase;
  usageReportRunner?: UsageReportRunnerController;
  releaseGateRunner?: ReleaseGateRunnerController;
}

import type {
  BatchCancelSourceAIReadyUseCase,
  BatchStartSourceAIReadyUseCase,
  CancelAIReadyJobUseCase,
  CancelSourceAIReadyUseCase,
  CreateAIReadyJobUseCase,
  CreateProjectUseCase,
  CreateSourceLibraryUseCase,
  CreateSourceUseCase,
  DeleteProjectUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DownloadSourceUseCase,
  GetAIReadyJobUseCase,
  GetProjectUseCase,
  GetSourceUseCase,
  GetSourcesQuotaUseCase,
  ListProjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  RetrySourceAIReadyUseCase,
  RunQueuedAIReadyJobUseCase,
  StartSourceAIReadyUseCase,
  UpdateProjectUseCase,
  UpdateSourceLibraryUseCase,
} from '@mbos/application';
import type { InMemoryJobQueue } from '@mbos/adapters-private';
import type { CachePort } from '@mbos/ports';
import type { ChatResourceService } from './chat-resource-service.js';
import type { EndpointResourceService } from './endpoint-resource-service.js';

export interface NodeApiDeps {
  cache: CachePort;
  chatResourceService: ChatResourceService;
  endpointResourceService: EndpointResourceService;
  sourceBucket: string;
  aiReadyJobQueue: InMemoryJobQueue;
  createAIReadyJobUseCase: CreateAIReadyJobUseCase;
  createSourceLibraryUseCase: CreateSourceLibraryUseCase;
  createProjectUseCase: CreateProjectUseCase;
  createSourceUseCase: CreateSourceUseCase;
  deleteSourceLibraryUseCase: DeleteSourceLibraryUseCase;
  deleteSourceUseCase: DeleteSourceUseCase;
  downloadSourceUseCase: DownloadSourceUseCase;
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
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  cancelAIReadyJobUseCase: CancelAIReadyJobUseCase;
  runQueuedAIReadyJobUseCase: RunQueuedAIReadyJobUseCase;
}

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  CreateSourceLibraryRequestSchema,
  CreateProjectRequestSchema,
  CreateSourceRequestSchema,
  ErrorResponseSchema,
  UpdateSourceLibraryRequestSchema,
  UpdateProjectRequestSchema,
} from '@mbos/contracts';
import {
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetSourcesQuotaUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
} from '@mbos/application';
import {
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  JsonDocSourceRepo,
  JsonDocSourceLibraryRepo,
  MinioObjectStore,
  MongoJsonDocStore,
  RedisCache,
  createProjectRepoFactoryResult,
  type ProjectRepoFactoryResult,
  SimpleIdGenerator,
  SystemClock,
} from '@mbos/adapters-private';

export interface NodeApiDeps {
  createSourceLibraryUseCase: CreateSourceLibraryUseCase;
  createProjectUseCase: CreateProjectUseCase;
  createSourceUseCase: CreateSourceUseCase;
  deleteSourceLibraryUseCase: DeleteSourceLibraryUseCase;
  deleteSourceUseCase: DeleteSourceUseCase;
  downloadSourceUseCase: DownloadSourceUseCase;
  getSourceUseCase: GetSourceUseCase;
  getSourcesQuotaUseCase: GetSourcesQuotaUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listSourceLibrariesUseCase: ListSourceLibrariesUseCase;
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
}

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const objectStore = new InMemoryObjectStore();

  return {
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      'mbos-dev',
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, 'mbos-dev'),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, 'mbos-dev'),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, new SystemClock()),
  };
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function applyCors(res: http.ServerResponse): void {
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Idempotency-Key',
  );
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

type ProjectsRoute =
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'sources'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraries'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourcesQuota'; workspaceId: string; projectId: string }
  | { kind: 'sourceItem'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceDownload'; workspaceId: string; projectId: string; sourceId: string };

function matchProjectsRoute(url: string): ProjectsRoute | null {
  const pathname = new URL(url, 'http://localhost').pathname;
  const collectionMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/?$/);
  if (collectionMatched) {
    return { kind: 'collection', workspaceId: decodeURIComponent(collectionMatched[1]) };
  }

  const itemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/?$/);
  if (itemMatched) {
    return {
      kind: 'item',
      workspaceId: decodeURIComponent(itemMatched[1]),
      projectId: decodeURIComponent(itemMatched[2]),
    };
  }

  const sourcesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/?$/);
  if (sourcesMatched) {
    return {
      kind: 'sources',
      workspaceId: decodeURIComponent(sourcesMatched[1]),
      projectId: decodeURIComponent(sourcesMatched[2]),
    };
  }

  const sourceLibrariesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/?$/,
  );
  if (sourceLibrariesMatched) {
    return {
      kind: 'sourceLibraries',
      workspaceId: decodeURIComponent(sourceLibrariesMatched[1]),
      projectId: decodeURIComponent(sourceLibrariesMatched[2]),
    };
  }

  const sourceLibraryItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/?$/,
  );
  if (sourceLibraryItemMatched) {
    return {
      kind: 'sourceLibraryItem',
      workspaceId: decodeURIComponent(sourceLibraryItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryItemMatched[3]),
    };
  }

  const sourcesQuotaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/quota\/?$/,
  );
  if (sourcesQuotaMatched) {
    return {
      kind: 'sourcesQuota',
      workspaceId: decodeURIComponent(sourcesQuotaMatched[1]),
      projectId: decodeURIComponent(sourcesQuotaMatched[2]),
    };
  }

  const sourceItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/?$/,
  );
  if (sourceItemMatched) {
    return {
      kind: 'sourceItem',
      workspaceId: decodeURIComponent(sourceItemMatched[1]),
      projectId: decodeURIComponent(sourceItemMatched[2]),
      sourceId: decodeURIComponent(sourceItemMatched[3]),
    };
  }

  const sourceDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/download\/?$/,
  );
  if (sourceDownloadMatched) {
    return {
      kind: 'sourceDownload',
      workspaceId: decodeURIComponent(sourceDownloadMatched[1]),
      projectId: decodeURIComponent(sourceDownloadMatched[2]),
      sourceId: decodeURIComponent(sourceDownloadMatched[3]),
    };
  }

  return null;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: NodeApiDeps): Promise<void> {
  applyCors(res);
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const route = matchProjectsRoute(req.url ?? '');
  if (!route) {
    json(res, 404, { code: 'NOT_FOUND', message: 'Route not found' });
    return;
  }

  try {
    if (route.kind === 'collection' && method === 'GET') {
      const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
      json(res, 200, listed);
      return;
    }

    if (route.kind === 'collection' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateProjectRequestSchema.parse(raw);
      const actorId = 'user_mock_owner';

      const created = await deps.createProjectUseCase.execute({
        workspaceId: route.workspaceId,
        actorId,
        input,
      });

      json(res, 201, created);
      return;
    }

    if (route.kind === 'item' && method === 'GET') {
      const found = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, found);
      return;
    }

    if (route.kind === 'item' && method === 'PATCH') {
      const raw = await readBody(req);
      const input = UpdateProjectRequestSchema.parse(raw);
      const updated = await deps.updateProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input,
      });
      json(res, 200, updated);
      return;
    }

    if (route.kind === 'item' && method === 'DELETE') {
      await deps.deleteProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sources' && method === 'GET') {
      const listed = await deps.listSourcesUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, listed);
      return;
    }

    if (route.kind === 'sources' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateSourceRequestSchema.parse(raw);
      const created = await deps.createSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input,
      });
      json(res, 201, created);
      return;
    }

    if (route.kind === 'sourceLibraries' && method === 'GET') {
      const listed = await deps.listSourceLibrariesUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, listed);
      return;
    }

    if (route.kind === 'sourceLibraries' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateSourceLibraryRequestSchema.parse(raw);
      const created = await deps.createSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorId: 'user_mock_owner',
        input,
      });
      json(res, 201, created);
      return;
    }

    if (route.kind === 'sourceLibraryItem' && method === 'PATCH') {
      const raw = await readBody(req);
      const input = UpdateSourceLibraryRequestSchema.parse(raw);
      const updated = await deps.updateSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
        input,
      });
      json(res, 200, updated);
      return;
    }

    if (route.kind === 'sourceLibraryItem' && method === 'DELETE') {
      await deps.deleteSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sourcesQuota' && method === 'GET') {
      const quota = await deps.getSourcesQuotaUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, quota);
      return;
    }

    if (route.kind === 'sourceItem' && method === 'DELETE') {
      await deps.deleteSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sourceItem' && method === 'GET') {
      const source = await deps.getSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      json(res, 200, source);
      return;
    }

    if (route.kind === 'sourceDownload' && method === 'GET') {
      const source = await deps.downloadSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      res.statusCode = 200;
      res.setHeader('content-type', source.source.content_type);
      res.setHeader(
        'content-disposition',
        `attachment; filename=\"${encodeURIComponent(source.source.name)}\"`,
      );
      res.end(Buffer.from(source.body));
      return;
    }

    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof Error && error.message === 'project_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'project_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_library_not_found' });
      return;
    }

    const parsed = ErrorResponseSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    json(res, 400, parsed.success ? parsed.data : { code: 'BAD_REQUEST', message: 'Bad request' });
  }
}

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });

  if (lifecycle) {
    server.on('close', () => {
      void lifecycle.shutdown();
    });
  }

  server.listen(port);
  return server;
}

function startFromCli(): void {
  const portRaw = process.env.PORT;
  const port = portRaw ? Number(portRaw) : 3010;
  if (!Number.isInteger(port) || port <= 0) {
    // Keep startup validation explicit for ops.
    throw new Error('invalid_port');
  }

  const factory = createProjectRepoFactoryResult({
    databaseUrl: process.env.DATABASE_URL,
  });
  const cache = process.env.REDIS_URL
    ? new RedisCache({ url: process.env.REDIS_URL })
    : new InMemoryCache();
  const docStore = process.env.MONGO_URL
    ? new MongoJsonDocStore({
      url: process.env.MONGO_URL,
      dbName: process.env.MONGO_DB_NAME ?? 'mbos',
    })
    : new InMemoryJsonDocStore();
  const objectStore = process.env.MINIO_ENDPOINT
    ? new MinioObjectStore({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT ?? '19000'),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'mbos',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'mbos_dev_password',
    })
    : new InMemoryObjectStore();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const sourceBucket = process.env.MINIO_BUCKET ?? 'mbos-dev';
  const deps: NodeApiDeps = {
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, new SystemClock()),
  };
  createNodeApiServer(port, deps, factory);
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${process.env.DATABASE_URL ? 'postgres' : 'memory'})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}

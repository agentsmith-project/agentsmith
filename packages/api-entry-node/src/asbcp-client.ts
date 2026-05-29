const REDACTED_ASBCP_VALUE = '[redacted]';
const ASBCP_ERROR_TEXT_MAX_CHARS = 2_000;
const SENSITIVE_ASBCP_FIELD_PATTERN =
  String.raw`(?:token|secret|password|api[\s_-]*key|access[\s_-]*key|service[\s_-]*keys?|authorization)`;
const SENSITIVE_JSON_FIELD_RE = new RegExp(
  String.raw`("(?:(?:[^"\\]|\\.)*)${SENSITIVE_ASBCP_FIELD_PATTERN}(?:(?:[^"\\]|\\.)*)"\s*:\s*)"((?:[^"\\]|\\.)*)"`,
  'gi',
);
const SENSITIVE_JSON_OBJECT_VALUE_FIELD_RE = new RegExp(
  String.raw`("(?:(?:[^"\\]|\\.)*)${SENSITIVE_ASBCP_FIELD_PATTERN}(?:(?:[^"\\]|\\.)*)"\s*:\s*\{\s*"value"\s*:\s*)"((?:[^"\\]|\\.)*)"`,
  'gi',
);
const SENSITIVE_IDENTIFIER_OBJECT_VALUE_FIELD_RE = new RegExp(
  String.raw`(\b[A-Z0-9_-]*${SENSITIVE_ASBCP_FIELD_PATTERN}[A-Z0-9_-]*\b\s*[:=]\s*\{\s*value\s*[:=]\s*)([^\s,;}]+)`,
  'gi',
);
const SENSITIVE_LABEL_KV_FIELD_RE = new RegExp(
  String.raw`(\b${SENSITIVE_ASBCP_FIELD_PATTERN}\b\s*[:=]\s*)([^\s,;}"']+)`,
  'gi',
);
const SENSITIVE_IDENTIFIER_KV_FIELD_RE = new RegExp(
  String.raw`(\b[A-Z0-9_-]*${SENSITIVE_ASBCP_FIELD_PATTERN}[A-Z0-9_-]*\b\s*[:=]\s*)([^\s,;}"']+)`,
  'gi',
);
const SENSITIVE_BEARER_RE = /(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/-]+=*/gi;

export function redactAsbcpLogText(value: string): string {
  const truncated = value.length > ASBCP_ERROR_TEXT_MAX_CHARS
    ? `${value.slice(0, ASBCP_ERROR_TEXT_MAX_CHARS)} [truncated]`
    : value;
  return truncated
    .replace(SENSITIVE_JSON_OBJECT_VALUE_FIELD_RE, `$1"${REDACTED_ASBCP_VALUE}"`)
    .replace(SENSITIVE_JSON_FIELD_RE, `$1"${REDACTED_ASBCP_VALUE}"`)
    .replace(SENSITIVE_IDENTIFIER_OBJECT_VALUE_FIELD_RE, `$1${REDACTED_ASBCP_VALUE}`)
    .replace(SENSITIVE_BEARER_RE, `$1${REDACTED_ASBCP_VALUE}`)
    .replace(SENSITIVE_IDENTIFIER_KV_FIELD_RE, `$1${REDACTED_ASBCP_VALUE}`)
    .replace(SENSITIVE_LABEL_KV_FIELD_RE, `$1${REDACTED_ASBCP_VALUE}`);
}

function buildAsbcpErrorMessage(operation: string, status: number, responseText: string): string {
  const safeText = redactAsbcpLogText(responseText).trim();
  return `asbcp_error: ${operation} ${status}${safeText ? ` ${safeText}` : ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readStringField(record: Record<string, unknown>, snakeKey: string, camelKey?: string): string | undefined {
  return readNonEmptyString(record[snakeKey]) ?? (camelKey ? readNonEmptyString(record[camelKey]) : undefined);
}

function isBareSha256Digest(value: string | undefined): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(value ?? '');
}

function parseAsbcpJsonObject(responseText: string): Record<string, unknown> | undefined {
  if (!responseText.trim().startsWith('{')) {
    return undefined;
  }
  try {
    const payload = JSON.parse(responseText) as unknown;
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function readAsbcpErrorRecord(responseText: string): Record<string, unknown> | undefined {
  const payload = parseAsbcpJsonObject(responseText);
  if (!payload) {
    return undefined;
  }
  return isRecord(payload.error) ? payload.error : payload;
}

function readAsbcpErrorCode(responseText: string): string | undefined {
  const error = readAsbcpErrorRecord(responseText);
  if (!error) {
    return undefined;
  }
  return readStringField(error, 'code')
    ?? readStringField(error, 'error_code', 'errorCode');
}

function readAsbcpRequestIdFromBody(responseText: string): string | undefined {
  const payload = parseAsbcpJsonObject(responseText);
  if (!payload) {
    return undefined;
  }
  const error = isRecord(payload.error) ? payload.error : undefined;
  return (error
    ? readStringField(error, 'request_id', 'requestId')
      ?? readStringField(error, 'correlation_id', 'correlationId')
    : undefined)
    ?? readStringField(payload, 'request_id', 'requestId')
    ?? readStringField(payload, 'correlation_id', 'correlationId');
}

function readAsbcpResponseRequestId(resp: Response, responseText: string): string | undefined {
  return readNonEmptyString(resp.headers.get('x-request-id'))
    ?? readNonEmptyString(resp.headers.get('x-asbcp-request-id'))
    ?? readAsbcpRequestIdFromBody(responseText);
}

function isAsbcpReleaseDeleteOperation(operation: string): boolean {
  return operation === 'delete_pod' || operation === 'delete_workspace_binding';
}

const ASBCP_RELEASE_INCOMPLETE_ERROR_CODES = new Set([
  'workload_release_incomplete',
  'workspace_binding_release_incomplete',
]);

function isAsbcpReleaseUnconfirmedConflict(
  status: number,
  operation: string,
  responseText: string,
): boolean {
  if (status !== 409 || !isAsbcpReleaseDeleteOperation(operation)) {
    return false;
  }
  const asbcpCode = readAsbcpErrorCode(responseText);
  return asbcpCode !== undefined && ASBCP_RELEASE_INCOMPLETE_ERROR_CODES.has(asbcpCode);
}

export interface PodStatusResponse {
  pod_name?: string;
  phase: string;
  ip?: string;
  image?: string;
  image_ref?: string;
  image_id?: string;
  started_at?: string;
  expires_at?: string;
  message?: string;
  status_source?: 'current_status';
  delete_terminal_confirmed?: boolean;
}

export interface ExecResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface SandboxPodCreateBody {
  image: string;
  env?: Record<string, string>;
  cpu_request?: string;
  cpu_limit?: string;
  memory_request?: string;
  memory_limit?: string;
  idle_timeout_sec?: number;
  max_lifetime_sec?: number;
  workspace_binding_id: string;
}

export interface SandboxWorkspaceBindingBody {
  namespace_id: string;
  mount_binding_id: string;
}

export interface SandboxWorkspaceBindingResponse {
  binding_id: string;
  workspace_id: string;
  project_id: string;
  namespace_id: string;
  mount_binding_id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface SandboxPodEnsureResponse {
  httpStatus: number;
  pod?: PodStatusResponse;
  workloadId?: string;
  status?: string;
  correlationId?: string;
  operationId?: string;
}

function readPodStatusResponse(value: unknown): PodStatusResponse | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const phase = readNonEmptyString(value.phase);
  if (!phase) {
    return undefined;
  }
  const status: PodStatusResponse = { phase };
  const podName = readNonEmptyString(value.pod_name);
  const ip = readNonEmptyString(value.ip);
  const image = readPodImage(value);
  const imageRef = readPodImageRef(value, image);
  const imageId = readPodImageId(value);
  const startedAt = readNonEmptyString(value.started_at);
  const expiresAt = readNonEmptyString(value.expires_at);
  const message = readNonEmptyString(value.message);
  if (podName) status.pod_name = podName;
  if (ip) status.ip = ip;
  if (image) status.image = image;
  if (imageRef) status.image_ref = imageRef;
  if (imageId) status.image_id = imageId;
  if (startedAt) status.started_at = startedAt;
  if (expiresAt) status.expires_at = expiresAt;
  if (message) status.message = message;
  if (value.status_source === 'current_status') {
    status.status_source = 'current_status';
  }
  if (typeof value.delete_terminal_confirmed === 'boolean') {
    status.delete_terminal_confirmed = value.delete_terminal_confirmed;
  }
  return status;
}

function readPodImage(record: Record<string, unknown>): string | undefined {
  return readNonEmptyString(record.image) ?? readSpecContainerImage(record);
}

function readPodImageRef(record: Record<string, unknown>, image?: string): string | undefined {
  return readStringField(record, 'image_ref', 'imageRef')
    ?? image
    ?? readContainerStatusesImage(record)
    ?? (isRecord(record.status) ? readContainerStatusesImage(record.status) : undefined);
}

function readPodImageId(record: Record<string, unknown>): string | undefined {
  const imageId = readStringField(record, 'image_id', 'imageID');
  const containerImageId = readContainerStatusesImageId(record)
    ?? (isRecord(record.status) ? readContainerStatusesImageId(record.status) : undefined);
  if (imageId && !isBareSha256Digest(imageId)) {
    return imageId;
  }
  return containerImageId ?? imageId;
}

function readSpecContainerImage(record: Record<string, unknown>): string | undefined {
  const spec = isRecord(record.spec) ? record.spec : undefined;
  const containers = spec?.containers;
  if (!Array.isArray(containers)) {
    return undefined;
  }
  for (const item of containers) {
    if (!isRecord(item)) {
      continue;
    }
    const image = readNonEmptyString(item.image);
    if (image) {
      return image;
    }
  }
  return undefined;
}

function readContainerStatusesImage(record: Record<string, unknown>): string | undefined {
  const statuses = record.containerStatuses;
  if (!Array.isArray(statuses)) {
    return undefined;
  }
  for (const item of statuses) {
    if (!isRecord(item)) {
      continue;
    }
    const image = readNonEmptyString(item.image);
    if (image) {
      return image;
    }
  }
  return undefined;
}

function readContainerStatusesImageId(record: Record<string, unknown>): string | undefined {
  const statuses = record.containerStatuses;
  if (!Array.isArray(statuses)) {
    return undefined;
  }
  for (const item of statuses) {
    if (!isRecord(item)) {
      continue;
    }
    const imageId = readStringField(item, 'image_id', 'imageID');
    if (imageId) {
      return imageId;
    }
  }
  return undefined;
}

function parsePodEnsurePayload(httpStatus: number, payload: unknown): SandboxPodEnsureResponse {
  if (!isRecord(payload)) {
    return { httpStatus };
  }
  const nestedPod = readPodStatusResponse(payload.pod);
  const inlinePod = readPodStatusResponse(payload);
  const pod = nestedPod ?? inlinePod;
  const workloadId = readStringField(payload, 'workload_id', 'workloadId');
  const status = readStringField(payload, 'status');
  const correlationId = readStringField(payload, 'correlation_id', 'correlationId');
  const operationId = readStringField(payload, 'operation_id', 'operationId');
  return {
    httpStatus,
    ...(pod ? { pod } : {}),
    ...(workloadId ? { workloadId } : {}),
    ...(status ? { status } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(operationId ? { operationId } : {}),
  };
}

export class AsbcpHttpError extends Error {
  code: string;
  asbcpCode?: string;
  status: number;
  operation: string;
  retryable: boolean;
  requestId?: string;

  constructor(input: {
    status: number;
    operation: string;
    message: string;
    code: string;
    asbcpCode?: string;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(redactAsbcpLogText(input.message));
    this.name = 'AsbcpHttpError';
    this.status = input.status;
    this.operation = input.operation;
    this.code = input.code;
    if (input.asbcpCode) {
      this.asbcpCode = input.asbcpCode;
    }
    this.retryable = input.retryable ?? false;
    if (input.requestId) {
      this.requestId = input.requestId;
    }
  }
}

export class AsbcpClient {
  private readonly normalizedBaseUrl: string;

  constructor(
    baseUrl: string,
    private readonly serviceKey: string,
  ) {
    this.normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static buildAbortError(reason?: unknown): Error {
    const error = new Error(
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string' && reason.trim().length > 0
          ? reason
          : 'request_aborted',
    );
    error.name = 'AbortError';
    return error;
  }

  private static isAbortLikeNetworkError(error: unknown): boolean {
    const name = error instanceof Error ? error.name : undefined;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return true;
    }
    const message = error instanceof Error
      ? error.message
      : (typeof error === 'string' ? error : '');
    return /(aborted|abort|timeout|timed out)/i.test(message);
  }

  private buildUrl(path: string): string {
    return `${this.normalizedBaseUrl}${path}`;
  }

  private headers(contentType = false): Record<string, string> {
    return {
      'X-Service-Key': this.serviceKey,
      ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private buildRequestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!signal) {
      return timeoutSignal;
    }
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([signal, timeoutSignal]);
    }
    const controller = new AbortController();
    const abortFrom = (source: AbortSignal) => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort(source.reason);
      cleanup();
    };
    const handleAbort = () => abortFrom(signal);
    const handleTimeout = () => abortFrom(timeoutSignal);
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      timeoutSignal.removeEventListener('abort', handleTimeout);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    timeoutSignal.addEventListener('abort', handleTimeout, { once: true });
    if (signal.aborted) {
      abortFrom(signal);
    } else if (timeoutSignal.aborted) {
      abortFrom(timeoutSignal);
    }
    return controller.signal;
  }

  private mapErrorCode(status: number, operation: string, responseText: string): string {
    if (status === 403) return 'AGENT_SANDBOX_FORBIDDEN';
    if (status === 404) return 'AGENT_SANDBOX_NOT_FOUND';
    if (status === 409) {
      return isAsbcpReleaseUnconfirmedConflict(status, operation, responseText)
        ? 'AGENT_SANDBOX_RELEASE_INCOMPLETE'
        : 'AGENT_SANDBOX_CONFLICT';
    }
    if (status === 429) return 'AGENT_SANDBOX_RATE_LIMITED';
    if (status >= 500) return 'AGENT_SANDBOX_UNAVAILABLE';
    return 'AGENT_SANDBOX_HTTP_ERROR';
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
  }

  private isRetryableHttpError(status: number, operation: string, responseText: string): boolean {
    return this.isRetryableStatus(status)
      || isAsbcpReleaseUnconfirmedConflict(status, operation, responseText);
  }

  private async requestWithRetry(
    operation: string,
    request: () => Promise<Response>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) {
        throw AsbcpClient.buildAbortError(signal.reason);
      }
      try {
        const resp = await request();
        if (!resp.ok && this.isRetryableStatus(resp.status) && attempt < maxAttempts) {
          if (signal?.aborted) {
            throw AsbcpClient.buildAbortError(signal.reason);
          }
          await AsbcpClient.sleep(200 * (2 ** (attempt - 1)));
          continue;
        }
        return resp;
      } catch (error) {
        if (signal?.aborted) {
          throw AsbcpClient.buildAbortError(signal.reason ?? error);
        }
        lastError = error;
        if (AsbcpClient.isAbortLikeNetworkError(error)) break;
        if (attempt >= maxAttempts) break;
        if (signal?.aborted) {
          throw AsbcpClient.buildAbortError(signal.reason ?? error);
        }
        await AsbcpClient.sleep(200 * (2 ** (attempt - 1)));
      }
    }
    const message = redactAsbcpLogText(lastError instanceof Error ? lastError.message : 'unknown_network_error');
    throw Object.assign(new Error(`asbcp_network_error: ${operation} ${message}`), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
    });
  }

  private async expectOk(
    operation: string,
    request: () => Promise<Response>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const resp = await this.requestWithRetry(operation, request, signal);
    if (resp.ok) return resp;
    const text = await resp.text().catch(() => '');
    throw new AsbcpHttpError({
      status: resp.status,
      operation,
      code: this.mapErrorCode(resp.status, operation, text),
      asbcpCode: readAsbcpErrorCode(text),
      retryable: this.isRetryableHttpError(resp.status, operation, text),
      requestId: readAsbcpResponseRequestId(resp, text),
      message: buildAsbcpErrorMessage(operation, resp.status, text),
    });
  }

  async checkReady(signal?: AbortSignal): Promise<void> {
    const url = this.buildUrl('/readyz');
    await this.expectOk('readyz', async () => fetch(url, {
      headers: this.headers(),
      signal: this.buildRequestSignal(5_000, signal),
    }), signal);
  }

  async createOrEnsurePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    body: SandboxPodCreateBody,
    signal?: AbortSignal,
  ): Promise<SandboxPodEnsureResponse> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.expectOk('create_or_ensure_pod', async () => fetch(url, {
      method: 'PUT',
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal: this.buildRequestSignal(150_000, signal),
    }), signal);
    return parsePodEnsurePayload(resp.status, await resp.json().catch(() => undefined));
  }

  async ensureWorkspaceBinding(
    workspaceId: string,
    projectId: string,
    bindingId: string,
    body: SandboxWorkspaceBindingBody,
  ): Promise<SandboxWorkspaceBindingResponse> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workspace-bindings/${encodeURIComponent(bindingId)}`,
    );
    const resp = await this.expectOk('ensure_workspace_binding', async () => fetch(url, {
      method: 'PUT',
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }));
    return await resp.json() as SandboxWorkspaceBindingResponse;
  }

  async deleteWorkspaceBinding(
    workspaceId: string,
    projectId: string,
    bindingId: string,
  ): Promise<void> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workspace-bindings/${encodeURIComponent(bindingId)}`,
    );
    const resp = await this.requestWithRetry('delete_workspace_binding', async () => fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    }));
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AsbcpHttpError({
        status: resp.status,
        operation: 'delete_workspace_binding',
        code: this.mapErrorCode(resp.status, 'delete_workspace_binding', text),
        asbcpCode: readAsbcpErrorCode(text),
        retryable: this.isRetryableHttpError(resp.status, 'delete_workspace_binding', text),
        requestId: readAsbcpResponseRequestId(resp, text),
        message: buildAsbcpErrorMessage('delete_workspace_binding', resp.status, text),
      });
    }
  }

  async getPodStatus(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    signal?: AbortSignal,
  ): Promise<PodStatusResponse> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.requestWithRetry('get_pod_status', async () => fetch(url, {
      headers: this.headers(),
      signal: this.buildRequestSignal(10_000, signal),
    }), signal);
    if (!resp.ok) {
      if (resp.status === 404) {
        return {
          phase: 'offline',
          message: 'pod_not_found_current_status',
          status_source: 'current_status',
          delete_terminal_confirmed: false,
        };
      }
      const text = await resp.text().catch(() => '');
      throw new AsbcpHttpError({
        status: resp.status,
        operation: 'get_pod_status',
        code: this.mapErrorCode(resp.status, 'get_pod_status', text),
        asbcpCode: readAsbcpErrorCode(text),
        retryable: this.isRetryableHttpError(resp.status, 'get_pod_status', text),
        requestId: readAsbcpResponseRequestId(resp, text),
        message: buildAsbcpErrorMessage('get_pod_status', resp.status, text),
      });
    }
    return readPodStatusResponse(await resp.json().catch(() => undefined)) ?? { phase: 'unknown' };
  }

  async deletePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.requestWithRetry('delete_pod', async () => fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
      signal: this.buildRequestSignal(15_000, signal),
    }), signal);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AsbcpHttpError({
        status: resp.status,
        operation: 'delete_pod',
        code: this.mapErrorCode(resp.status, 'delete_pod', text),
        asbcpCode: readAsbcpErrorCode(text),
        retryable: this.isRetryableHttpError(resp.status, 'delete_pod', text),
        requestId: readAsbcpResponseRequestId(resp, text),
        message: buildAsbcpErrorMessage('delete_pod', resp.status, text),
      });
    }
  }

  async keepalive(
    workspaceId: string,
    projectId: string,
    workloadId: string,
  ): Promise<string | null> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}/keepalive`,
    );
    const resp = await this.expectOk('keepalive', async () => fetch(url, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    }));
    const payload = await resp.json() as { expires_at?: string };
    return typeof payload.expires_at === 'string' ? payload.expires_at : null;
  }

  async exec(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    cmd: string[],
    timeoutSeconds = 30,
    signal?: AbortSignal,
  ): Promise<ExecResponse> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}/exec`,
    );
    const resp = await this.expectOk('exec', async () => fetch(url, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        cmd,
        timeout_seconds: timeoutSeconds,
      }),
      signal: this.buildRequestSignal((timeoutSeconds + 10) * 1_000, signal),
    }), signal);
    return await resp.json() as ExecResponse;
  }
}

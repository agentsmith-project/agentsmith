export interface PodStatusResponse {
  pod_name?: string;
  phase: string;
  ip?: string;
  started_at?: string;
  expires_at?: string;
  message?: string;
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
  workspace_binding_id?: string;
}

export interface SandboxWorkspaceBindingBody {
  file_library_id: string;
  filesystem_name: string;
  metadata_url: string;
  mount_path?: string;
  storage_endpoint?: string;
  storage_capacity?: string;
  storage_class_name?: string;
  mount_options?: string[];
  subdir?: string;
  mount_service_account?: string;
  mount_image?: string;
}

export interface SandboxWorkspaceBindingResponse {
  binding_id: string;
  workspace_id: string;
  project_id: string;
  file_library_id: string;
  status: string;
  namespace: string;
  secret_name: string;
  pv_name: string;
  pvc_name: string;
  volume_handle: string;
  filesystem_name: string;
  mount_path: string;
  storage_class_name?: string;
  mount_options?: string[];
  subdir?: string;
  created_at?: string;
  updated_at?: string;
}

export class SandboxManagerHttpError extends Error {
  code: string;
  status: number;
  operation: string;

  constructor(input: { status: number; operation: string; message: string; code: string }) {
    super(input.message);
    this.name = 'SandboxManagerHttpError';
    this.status = input.status;
    this.operation = input.operation;
    this.code = input.code;
  }
}

export class SandboxManagerClient {
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

  private buildUrl(path: string): string {
    return `${this.normalizedBaseUrl}${path}`;
  }

  private headers(contentType = false): Record<string, string> {
    return {
      'X-Service-Key': this.serviceKey,
      ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private mapErrorCode(status: number): string {
    if (status === 403) return 'AGENT_SANDBOX_FORBIDDEN';
    if (status === 404) return 'AGENT_SANDBOX_NOT_FOUND';
    if (status === 429) return 'AGENT_SANDBOX_RATE_LIMITED';
    if (status >= 500) return 'AGENT_SANDBOX_UNAVAILABLE';
    return 'AGENT_SANDBOX_HTTP_ERROR';
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
  }

  private async requestWithRetry(
    operation: string,
    request: () => Promise<Response>,
  ): Promise<Response> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const resp = await request();
        if (!resp.ok && this.isRetryableStatus(resp.status) && attempt < maxAttempts) {
          await SandboxManagerClient.sleep(200 * (2 ** (attempt - 1)));
          continue;
        }
        return resp;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        await SandboxManagerClient.sleep(200 * (2 ** (attempt - 1)));
      }
    }
    const message = lastError instanceof Error ? lastError.message : 'unknown_network_error';
    throw Object.assign(new Error(`sandbox_manager_network_error: ${operation} ${message}`), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
    });
  }

  private async expectOk(
    operation: string,
    request: () => Promise<Response>,
  ): Promise<Response> {
    const resp = await this.requestWithRetry(operation, request);
    if (resp.ok) return resp;
    const text = await resp.text().catch(() => '');
    throw new SandboxManagerHttpError({
      status: resp.status,
      operation,
      code: this.mapErrorCode(resp.status),
      message: `sandbox_manager_error: ${operation} ${resp.status} ${text}`.trim(),
    });
  }

  async checkReady(): Promise<void> {
    const url = this.buildUrl('/readyz');
    await this.expectOk('readyz', async () => fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5_000),
    }));
  }

  async createOrEnsurePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
    body: SandboxPodCreateBody,
  ): Promise<{ httpStatus: number; pod: PodStatusResponse }> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.expectOk('create_or_ensure_pod', async () => fetch(url, {
      method: 'PUT',
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    }));
    return {
      httpStatus: resp.status,
      pod: await resp.json() as PodStatusResponse,
    };
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
    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text().catch(() => '');
      throw new SandboxManagerHttpError({
        status: resp.status,
        operation: 'delete_workspace_binding',
        code: this.mapErrorCode(resp.status),
        message: `sandbox_manager_error: delete_workspace_binding ${resp.status} ${text}`.trim(),
      });
    }
  }

  async getPodStatus(
    workspaceId: string,
    projectId: string,
    workloadId: string,
  ): Promise<PodStatusResponse> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.requestWithRetry('get_pod_status', async () => fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    }));
    if (!resp.ok) {
      if (resp.status === 404) {
        return { phase: 'offline' };
      }
      const text = await resp.text().catch(() => '');
      throw new SandboxManagerHttpError({
        status: resp.status,
        operation: 'get_pod_status',
        code: this.mapErrorCode(resp.status),
        message: `sandbox_manager_error: get_pod_status ${resp.status} ${text}`.trim(),
      });
    }
    return await resp.json() as PodStatusResponse;
  }

  async deletePod(
    workspaceId: string,
    projectId: string,
    workloadId: string,
  ): Promise<void> {
    const url = this.buildUrl(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/projects/${encodeURIComponent(projectId)}`
      + `/workloads/${encodeURIComponent(workloadId)}`,
    );
    const resp = await this.requestWithRetry('delete_pod', async () => fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    }));
    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text().catch(() => '');
      throw new SandboxManagerHttpError({
        status: resp.status,
        operation: 'delete_pod',
        code: this.mapErrorCode(resp.status),
        message: `sandbox_manager_error: delete_pod ${resp.status} ${text}`.trim(),
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
      signal: AbortSignal.timeout((timeoutSeconds + 10) * 1_000),
    }));
    return await resp.json() as ExecResponse;
  }
}

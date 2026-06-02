#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FIXTURE_SCOPE = 'gate_owned_afscp_read_export_probe';
const READY_STATES = new Set(['succeeded', 'success', 'completed', 'ready']);
const FAILED_STATES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);
const PRODUCT_ROLES = [
  'repo_admin',
  'repo_lifecycle_admin',
  'restore_admin',
  'template_admin',
  'export_admin',
  'mount_admin',
  'operation_inspector',
];

const VALUE_PATTERNS = {
  namespace_id: /^ns_[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/,
  repo_id: /^repo_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  volume_id: /^vol_[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/,
};

class ProbeError extends Error {
  constructor(source, message, details = {}) {
    super(message);
    this.name = 'ProbeError';
    this.source = source;
    this.details = details;
  }
}

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function requireEnv(name) {
  const value = readEnv(name);
  if (!value) {
    throw new ProbeError('afscp_runtime_ready', `${name} is required`, { missing_env: name });
  }
  return value;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fingerprint(value) {
  if (!value) return '';
  const digest = createHash('sha256').update(String(value)).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

function stableMarker(config) {
  const configured = readEnv('AFSCP_READ_EXPORT_PROBE_MARKER');
  if (configured) {
    return configured.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'configured';
  }
  return createHash('sha256')
    .update(`${config.baseUrl}|${config.defaultVolumeId}`)
    .digest('hex')
    .slice(0, 16);
}

function validateId(kind, value) {
  if (!VALUE_PATTERNS[kind].test(value)) {
    throw new ProbeError('afscp_runtime_ready', `invalid ${kind}`, {
      [kind]: value,
    });
  }
  return value;
}

function safePreview(value, secrets) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return redact(raw.slice(0, 1200), secrets);
}

function redact(input, secrets = []) {
  let output = String(input ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  output = output
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|key)\s*[:=]\s*)"[^"]*"/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|key)\s*[:=]\s*)'[^']*'/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|key)\s*[:=]\s*)[^\s"',;&]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._-]{8,}/g, '[REDACTED]');
  return output;
}

function writeLog(event, secrets) {
  const logPath = readEnv('AFSCP_READ_EXPORT_PROBE_LOG');
  if (!logPath) return;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${redact(JSON.stringify(event), secrets)}\n`, 'utf8');
}

function publicUrlParts(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return {
      access_url_origin: parsed.origin,
      access_url_fingerprint: fingerprint(rawUrl),
    };
  } catch {
    return {
      access_url_origin: '<invalid>',
      access_url_fingerprint: fingerprint(rawUrl),
    };
  }
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function operationId(stage, payload) {
  if (payload && typeof payload.operation_id === 'string' && payload.operation_id.length > 0) {
    return payload.operation_id;
  }
  throw new ProbeError('afscp_runtime_ready', `${stage} response missing operation_id`, {
    stage,
  });
}

function operationState(payload) {
  return typeof payload?.operation_state === 'string' ? payload.operation_state.trim().toLowerCase() : '';
}

function buildConfig() {
  const baseUrl = requireEnv('AFSCP_BASE_URL').replace(/\/+$/g, '');
  const defaultVolumeId = validateId('volume_id', requireEnv('AFSCP_DEFAULT_VOLUME_ID'));
  const config = {
    baseUrl,
    defaultVolumeId,
    exportGatewayBaseUrl: readEnv('AFSCP_EXPORT_GATEWAY_BASE_URL'),
    productCaller: requireEnv('AFSCP_CALLER_SERVICE'),
    productToken: requireEnv('AFSCP_SERVICE_TOKEN'),
    bootstrapCaller: requireEnv('AFSCP_BOOTSTRAP_CALLER_SERVICE'),
    bootstrapToken: requireEnv('AFSCP_BOOTSTRAP_SERVICE_TOKEN'),
    orchestratorCaller: requireEnv('AFSCP_ORCHESTRATOR_CALLER_SERVICE'),
    timeoutMs: parsePositiveInteger(readEnv('AFSCP_READ_EXPORT_PROBE_TIMEOUT_MS', '60000'), 60000),
    requestTimeoutMs: parsePositiveInteger(readEnv('AFSCP_READ_EXPORT_PROBE_REQUEST_TIMEOUT_MS', '10000'), 10000),
  };
  const marker = stableMarker(config);
  return {
    ...config,
    marker,
    correlationId: readEnv('AFSCP_READ_EXPORT_PROBE_CORRELATION_ID', `afscp-read-export-probe-${marker}`),
    namespaceId: validateId(
      'namespace_id',
      readEnv('AFSCP_READ_EXPORT_PROBE_NAMESPACE_ID', `ns_gate_probe_${marker}`),
    ),
    repoId: validateId('repo_id', readEnv('AFSCP_READ_EXPORT_PROBE_REPO_ID', `repo_gate_probe_${marker}`)),
    actorId: readEnv('AFSCP_READ_EXPORT_PROBE_ACTOR_ID', 'agentsmith-read-export-probe'),
  };
}

function secretsFor(config, extra = []) {
  return [
    config.productToken,
    config.bootstrapToken,
    readEnv('AFSCP_ORCHESTRATOR_SERVICE_TOKEN'),
    readEnv('AFSCP_ORCHESTRATOR_TOKEN'),
    ...extra,
  ].filter(Boolean);
}

function headers(config, options) {
  const result = {
    Accept: 'application/json',
    Authorization: `Bearer ${options.token}`,
    'X-AFSCP-Caller-Service': options.callerService,
    'X-Correlation-Id': config.correlationId,
  };
  if (options.namespaceId) {
    result['X-AFSCP-Namespace-Id'] = options.namespaceId;
  }
  if (options.idempotencyKey) {
    result['Idempotency-Key'] = options.idempotencyKey;
    result['X-AFSCP-Actor-Type'] = 'operator';
    result['X-AFSCP-Actor-Id'] = config.actorId;
  }
  if (options.hasBody) {
    result['Content-Type'] = 'application/json';
  }
  return result;
}

async function withRequestTimeout(config, source, run, details = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof ProbeError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProbeError(source, `${source} request timed out`, {
        failure_class: source === 'webdav_propfind' ? 'webdav_propfind_timeout' : 'afscp_request_timeout',
        timeout_ms: config.requestTimeoutMs,
        correlation_id: config.correlationId,
        ...details,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function request(config, source, method, requestPath, options = {}) {
  const url = `${config.baseUrl}${requestPath}`;
  let response;
  let text;
  try {
    const result = await withRequestTimeout(
      config,
      source,
      async (signal) => {
        const nextResponse = await fetch(url, {
          method,
          headers: headers(config, {
            token: options.token,
            callerService: options.callerService,
            namespaceId: options.namespaceId,
            idempotencyKey: options.idempotencyKey,
            hasBody: options.body !== undefined,
          }),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal,
        });
        const nextText = await nextResponse.text();
        return { response: nextResponse, text: nextText };
      },
      { request_path: requestPath, method },
    );
    response = result.response;
    text = result.text;
  } catch (error) {
    if (error instanceof ProbeError) {
      throw error;
    }
    throw new ProbeError(source, `${source} network error`, {
      failure_class: 'backend_unavailable',
      message: error instanceof Error ? error.message : 'network error',
      correlation_id: config.correlationId,
    });
  }

  let payload = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    bodyPreview: safePreview(payload, secretsFor(config)),
  };
}

async function requestJson(config, source, method, requestPath, options = {}) {
  const response = await request(config, source, method, requestPath, options);
  if (!response.ok) {
    const payload = typeof response.payload === 'object' && response.payload !== null ? response.payload : {};
    throw new ProbeError(source, `${source} http ${response.status}`, {
      failure_class: response.status >= 500 ? 'backend_unavailable' : 'afscp_request_failed',
      http_status: response.status,
      afscp_error_code: typeof payload.error_code === 'string' ? payload.error_code : undefined,
      afscp_retryable: typeof payload.retryable === 'boolean' ? payload.retryable : undefined,
      correlation_id: config.correlationId,
      response_preview: response.bodyPreview,
    });
  }
  return response.payload;
}

async function assertRuntimeReady(config) {
  let response;
  try {
    response = await withRequestTimeout(
      config,
      'afscp_runtime_ready',
      (signal) => fetch(`${config.baseUrl}/readyz`, { signal }),
      { request_path: '/readyz', method: 'GET' },
    );
  } catch (error) {
    if (error instanceof ProbeError) {
      throw error;
    }
    throw new ProbeError('afscp_runtime_ready', 'AFSCP readyz network error', {
      failure_class: 'backend_unavailable',
      message: error instanceof Error ? error.message : 'network error',
      correlation_id: config.correlationId,
    });
  }
  if (response.status !== 200) {
    throw new ProbeError('afscp_runtime_ready', `AFSCP readyz returned http ${response.status}`, {
      failure_class: 'runtime_unready',
      http_status: response.status,
      correlation_id: config.correlationId,
    });
  }
}

async function pollOperation(config, stage, id) {
  const deadline = Date.now() + config.timeoutMs;
  let lastState = '';
  while (Date.now() <= deadline) {
    const operation = await requestJson(
      config,
      'afscp_runtime_ready',
      'GET',
      `/internal/v1/operations/${encodeURIComponent(id)}`,
      {
        token: config.bootstrapToken,
        callerService: config.bootstrapCaller,
      },
    );
    lastState = operationState(operation);
    if (READY_STATES.has(lastState)) {
      return operation;
    }
    if (FAILED_STATES.has(lastState)) {
      throw new ProbeError('afscp_runtime_ready', `${stage} operation failed`, {
        failure_class: 'afscp_operation_failed',
        operation_id_fingerprint: fingerprint(id),
        operation_state: lastState,
        correlation_id: config.correlationId,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new ProbeError('afscp_runtime_ready', `${stage} operation timed out`, {
    failure_class: 'afscp_operation_timeout',
    operation_id_fingerprint: fingerprint(id),
    operation_state: lastState || 'unknown',
    correlation_id: config.correlationId,
  });
}

function volumeBinding(config) {
  return {
    namespace_id: config.namespaceId,
    default_volume_id: config.defaultVolumeId,
    allowed_callers: [
      { caller_service: config.productCaller, roles: PRODUCT_ROLES },
      { caller_service: config.orchestratorCaller, roles: ['orchestrator_mount'] },
    ],
    quota_bytes_default: 0,
    export_policy: { webdav_enabled: true, max_session_seconds: 900 },
    lifecycle_policy: {
      tombstone_retention_seconds: 604800,
      purge_requires_lifecycle_admin: true,
      break_glass_purge_enabled: false,
    },
    mount_policy: {
      workload_mount_enabled: true,
      workload_mount_requires_external_control_root: true,
      allow_privileged_workload: false,
    },
    template_policy: {
      namespace_templates_enabled: true,
      cross_namespace_clone_enabled: false,
    },
    status: 'active',
  };
}

async function ensureProbeRepo(config) {
  const namespaceOperation = await requestJson(
    config,
    'afscp_runtime_ready',
    'PUT',
    `/internal/v1/namespaces/${encodeURIComponent(config.namespaceId)}`,
    {
      token: config.bootstrapToken,
      callerService: config.bootstrapCaller,
      namespaceId: config.namespaceId,
      idempotencyKey: `agentsmith-read-export-probe:${config.marker}:namespace`,
      body: { namespace_id: config.namespaceId },
    },
  );
  await pollOperation(config, 'namespace_upsert', operationId('namespace_upsert', namespaceOperation));

  const bindingOperation = await requestJson(
    config,
    'afscp_runtime_ready',
    'PUT',
    `/internal/v1/namespaces/${encodeURIComponent(config.namespaceId)}/volume-binding`,
    {
      token: config.bootstrapToken,
      callerService: config.bootstrapCaller,
      namespaceId: config.namespaceId,
      idempotencyKey: `agentsmith-read-export-probe:${config.marker}:volume-binding`,
      body: volumeBinding(config),
    },
  );
  await pollOperation(config, 'volume_binding', operationId('volume_binding', bindingOperation));

  const repoRead = await request(
    config,
    'afscp_runtime_ready',
    'GET',
    `/internal/v1/repos/${encodeURIComponent(config.repoId)}`,
    {
      token: config.productToken,
      callerService: config.productCaller,
      namespaceId: config.namespaceId,
    },
  );
  if (repoRead.ok) {
    return;
  }
  if (repoRead.status !== 404) {
    throw new ProbeError('afscp_runtime_ready', `probe repo lookup http ${repoRead.status}`, {
      failure_class: repoRead.status >= 500 ? 'backend_unavailable' : 'afscp_request_failed',
      http_status: repoRead.status,
      correlation_id: config.correlationId,
      response_preview: repoRead.bodyPreview,
    });
  }

  const repoOperation = await requestJson(config, 'afscp_runtime_ready', 'POST', '/internal/v1/repos', {
    token: config.productToken,
    callerService: config.productCaller,
    namespaceId: config.namespaceId,
    idempotencyKey: `agentsmith-read-export-probe:${config.marker}:repo`,
    body: {
      namespace_id: config.namespaceId,
      target_repo_id: config.repoId,
    },
  });
  await pollOperation(config, 'repo_create', operationId('repo_create', repoOperation));
}

function readExportAccess(config, envelope) {
  const result = envelope && typeof envelope === 'object' ? envelope.result : null;
  const access = result && typeof result === 'object' ? result.access : null;
  const exportSession = result && typeof result === 'object' ? result.export : null;
  const auth = access && typeof access === 'object' ? access.auth : null;
  const exportId = typeof exportSession?.export_id === 'string'
    ? exportSession.export_id
    : typeof envelope?.resource?.id === 'string'
      ? envelope.resource.id
      : '';
  if (
    !access
    || typeof access.url !== 'string'
    || access.mode !== 'read_only'
    || typeof access.expires_at !== 'string'
    || !auth
    || auth.type !== 'basic'
    || typeof auth.username !== 'string'
    || typeof auth.password !== 'string'
    || !exportId
  ) {
    throw new ProbeError('afscp_create_export', 'create export response did not include usable read-only access', {
      failure_class: 'export_access_unavailable',
      correlation_id: config.correlationId,
    });
  }
  return {
    exportId,
    access: {
      url: access.url,
      mode: access.mode,
      expires_at: access.expires_at,
      auth: {
        type: 'basic',
        username: auth.username,
        password: auth.password,
      },
    },
  };
}

async function createReadOnlyExport(config) {
  const exportNonce = randomBytes(8).toString('hex');
  const envelope = await requestJson(
    config,
    'afscp_create_export',
    'POST',
    `/internal/v1/repos/${encodeURIComponent(config.repoId)}/exports`,
    {
      token: config.productToken,
      callerService: config.productCaller,
      namespaceId: config.namespaceId,
      idempotencyKey: `agentsmith-read-export-probe:${config.marker}:read-export:${exportNonce}`,
      body: {
        mode: 'read_only',
        ttl_seconds: 60,
      },
    },
  );
  return readExportAccess(config, envelope);
}

function classifyWebdavStatus(status) {
  if (status === 401 || status === 403) {
    return 'admin_action_required';
  }
  if (status >= 500 || status === 0) {
    return 'backend_unavailable';
  }
  return 'webdav_propfind_failed';
}

async function propfind(config, exportContext) {
  if (config.exportGatewayBaseUrl && !sameOrigin(exportContext.access.url, config.exportGatewayBaseUrl)) {
    throw new ProbeError('afscp_create_export', 'create export access origin did not match configured gateway origin', {
      failure_class: 'export_gateway_origin_mismatch',
      correlation_id: config.correlationId,
      expected_access_url_origin: publicUrlParts(config.exportGatewayBaseUrl).access_url_origin,
      export_id_fingerprint: fingerprint(exportContext.exportId),
      ...publicUrlParts(exportContext.access.url),
    });
  }

  let response;
  let bodyText;
  const authValue = Buffer
    .from(`${exportContext.access.auth.username}:${exportContext.access.auth.password}`, 'utf8')
    .toString('base64');
  try {
    const result = await withRequestTimeout(
      config,
      'webdav_propfind',
      async (signal) => {
        const nextResponse = await fetch(exportContext.access.url, {
          method: 'PROPFIND',
          headers: {
            Authorization: `Basic ${authValue}`,
            Depth: '1',
          },
          signal,
        });
        const nextBodyText = await nextResponse.text();
        return { response: nextResponse, bodyText: nextBodyText };
      },
      {
        webdav_status: 0,
        export_id_fingerprint: fingerprint(exportContext.exportId),
        ...publicUrlParts(exportContext.access.url),
      },
    );
    response = result.response;
    bodyText = result.bodyText;
  } catch (error) {
    if (error instanceof ProbeError) {
      throw error;
    }
    throw new ProbeError('webdav_propfind', 'WebDAV PROPFIND network error', {
      failure_class: 'backend_unavailable',
      webdav_status: 0,
      correlation_id: config.correlationId,
      export_id_fingerprint: fingerprint(exportContext.exportId),
      ...publicUrlParts(exportContext.access.url),
      message: error instanceof Error ? error.message : 'network error',
    });
  }
  if (!response.ok) {
    throw new ProbeError('webdav_propfind', `WebDAV PROPFIND http ${response.status}`, {
      failure_class: classifyWebdavStatus(response.status),
      webdav_status: response.status,
      correlation_id: config.correlationId,
      export_id_fingerprint: fingerprint(exportContext.exportId),
      ...publicUrlParts(exportContext.access.url),
      response_preview: safePreview(bodyText, secretsFor(config, [
        exportContext.access.auth.username,
        exportContext.access.auth.password,
      ])),
    });
  }
  if (response.status !== 207 || !/<(?:[A-Za-z0-9_.-]+:)?multistatus\b/i.test(bodyText)) {
    throw new ProbeError('webdav_propfind', `WebDAV PROPFIND did not return multistatus`, {
      failure_class: 'webdav_multistatus_required',
      webdav_status: response.status,
      correlation_id: config.correlationId,
      export_id_fingerprint: fingerprint(exportContext.exportId),
      ...publicUrlParts(exportContext.access.url),
      response_preview: safePreview(bodyText, secretsFor(config, [
        exportContext.access.auth.username,
        exportContext.access.auth.password,
      ])),
    });
  }
  return response.status;
}

async function revokeExport(config, exportContext) {
  try {
    await requestJson(
      config,
      'afscp_revoke_export',
      'DELETE',
      `/internal/v1/exports/${encodeURIComponent(exportContext.exportId)}`,
      {
        token: config.productToken,
        callerService: config.productCaller,
        namespaceId: config.namespaceId,
        idempotencyKey: `agentsmith-read-export-probe:${config.marker}:revoke:${exportContext.exportId}`,
      },
    );
  } catch {
    // Cleanup is best-effort; the readiness verdict is the read-export/WebDAV path.
  }
}

async function runProbe() {
  const config = buildConfig();
  const secrets = secretsFor(config);
  writeLog({
    source: 'afscp_runtime_ready',
    status: 'started',
    fixture_scope: FIXTURE_SCOPE,
    correlation_id: config.correlationId,
    base_url: config.baseUrl,
    export_gateway_base_url: config.exportGatewayBaseUrl || '<unset>',
    default_volume_id: config.defaultVolumeId,
    namespace_id: config.namespaceId,
    repo_id: config.repoId,
  }, secrets);

  await assertRuntimeReady(config);
  await ensureProbeRepo(config);
  const exportContext = await createReadOnlyExport(config);
  let webdavStatus;
  try {
    webdavStatus = await propfind(config, exportContext);
  } finally {
    await revokeExport(config, exportContext);
  }

  const result = {
    status: 'passed',
    source: 'webdav_propfind',
    fixture_scope: FIXTURE_SCOPE,
    correlation_id: config.correlationId,
    namespace_id: config.namespaceId,
    repo_id: config.repoId,
    export_id_fingerprint: fingerprint(exportContext.exportId),
    ...publicUrlParts(exportContext.access.url),
    webdav_status: webdavStatus,
  };
  writeLog(result, secretsFor(config, [
    exportContext.access.auth.username,
    exportContext.access.auth.password,
  ]));
  return result;
}

try {
  const result = await runProbe();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const probeError = error instanceof ProbeError
    ? error
    : new ProbeError('afscp_runtime_ready', error instanceof Error ? error.message : 'unknown probe error');
  const configForSecrets = {
    productToken: readEnv('AFSCP_SERVICE_TOKEN'),
    bootstrapToken: readEnv('AFSCP_BOOTSTRAP_SERVICE_TOKEN'),
  };
  const result = {
    status: 'failed',
    source: probeError.source,
    fixture_scope: FIXTURE_SCOPE,
    message: probeError.message,
    ...probeError.details,
  };
  const secrets = secretsFor(configForSecrets);
  writeLog(result, secrets);
  process.stdout.write(`${redact(JSON.stringify(result, null, 2), secrets)}\n`);
  process.exitCode = 1;
}

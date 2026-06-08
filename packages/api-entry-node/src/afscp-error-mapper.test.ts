import { describe, expect, it } from 'vitest';
import {
  AfscpClientError,
  mapAfscpErrorEnvelope,
} from './afscp-error-mapper.js';

const sensitiveValues = [
  'secret-token-value',
  'SecretRef',
  'mount_plan',
  'jvs stdout leaked',
  'password=super-secret',
  'metadata_url',
  'postgres://postgres:postgres@db:5432/juicefs',
  'repo_hidden_elsewhere',
];

function expectNoSensitiveValues(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sensitive of sensitiveValues) {
    expect(serialized).not.toContain(sensitive);
  }
}

describe('mapAfscpErrorEnvelope', () => {
  it('maps namespace mismatch to non-leaking resource not found with only allowlisted fields', () => {
    const mapped = mapAfscpErrorEnvelope(403, {
      error: {
        code: 'RESOURCE_NAMESPACE_MISMATCH',
        message: 'repo_hidden_elsewhere belongs to ns_other',
        retryable: false,
        correlation_id: 'corr-1',
        operation_id: 'op_123',
        details: {
          resource: { type: 'repo', id: 'repo_hidden_elsewhere' },
          token: 'secret-token-value',
          mount_plan: { SecretRef: 'storage-root' },
          jvs_stdout: 'jvs stdout leaked',
          metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          password: 'super-secret',
        },
      },
    });

    expect(mapped).toEqual({
      status: 404,
      code: 'afscp_resource_not_found',
      message: 'afscp_resource_not_found',
      retryable: false,
      correlation_id: 'corr-1',
      operation_id: 'op_123',
      resource_kind: 'repo',
    });
    expect(Object.keys(mapped).sort()).toEqual([
      'code',
      'correlation_id',
      'message',
      'operation_id',
      'resource_kind',
      'retryable',
      'status',
    ]);
    expectNoSensitiveValues(mapped);
  });

  it('maps AFSCP not-found codes to the same non-leaking resource-not-found shape', () => {
    for (const code of ['NAMESPACE_NOT_FOUND', 'REPO_NOT_FOUND', 'VOLUME_NOT_FOUND', 'OPERATION_NOT_FOUND']) {
      const mapped = mapAfscpErrorEnvelope(404, {
        error: {
          code,
          message: `${code}: repo_hidden_elsewhere`,
          retryable: false,
          correlation_id: 'corr-not-found',
          details: {
            resource: { type: 'operation', id: 'op_secret' },
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      });

      expect(mapped).toMatchObject({
        status: 404,
        code: 'afscp_resource_not_found',
        message: 'afscp_resource_not_found',
        retryable: false,
        correlation_id: 'corr-not-found',
      });
      expectNoSensitiveValues(mapped);
    }
  });

  it('maps idempotency conflicts to conflict without echoing request hashes or tokens', () => {
    const mapped = mapAfscpErrorEnvelope(409, {
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'request hash mismatch password=super-secret',
        retryable: false,
        correlation_id: 'corr-2',
        details: {
          request_hash: 'secret-token-value',
          existing_request_hash: 'password=super-secret',
        },
      },
    });

    expect(mapped).toEqual({
      status: 409,
      code: 'conflict',
      message: 'conflict',
      retryable: false,
      correlation_id: 'corr-2',
    });
    expectNoSensitiveValues(mapped);
  });

  it('maps storage unavailable to retryable unavailable', () => {
    const mapped = mapAfscpErrorEnvelope(503, {
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'metadata_url unavailable postgres://postgres:postgres@db:5432/juicefs',
        retryable: false,
        correlation_id: 'corr-3',
      },
    });

    expect(mapped).toEqual({
      status: 503,
      code: 'unavailable',
      message: 'unavailable',
      retryable: true,
      correlation_id: 'corr-3',
    });
    expectNoSensitiveValues(mapped);
  });

  it('omits unsafe upstream correlation ids from mapped errors', () => {
    const mapped = mapAfscpErrorEnvelope(503, {
      error: {
        code: 'STORAGE_UNAVAILABLE',
        retryable: true,
        correlation_id: 'raw\r\nx-token=secret-token-value',
      },
    });

    expect(mapped).toEqual({
      status: 503,
      code: 'unavailable',
      message: 'unavailable',
      retryable: true,
    });
    expectNoSensitiveValues(mapped);
  });

  it('preserves expanded allowlisted resource kinds only as kind metadata', () => {
    const mapped = mapAfscpErrorEnvelope(404, {
      error: {
        code: 'RESOURCE_NAMESPACE_MISMATCH',
        retryable: false,
        correlation_id: 'corr-operation-resource',
        operation_id: 'op_456',
        details: {
          resource: { type: 'operation', id: 'op_hidden_elsewhere' },
        },
      },
    });

    expect(mapped).toMatchObject({
      status: 404,
      code: 'afscp_resource_not_found',
      resource_kind: 'operation',
      correlation_id: 'corr-operation-resource',
      operation_id: 'op_456',
    });
    expect(JSON.stringify(mapped)).not.toContain('op_hidden_elsewhere');
  });

  it('maps direct restore recovery envelopes to a stable caller action code', () => {
    const mapped = mapAfscpErrorEnvelope(409, {
      error: {
        code: 'JVS_JOURNAL_RECOVERY_REQUIRED',
        message: 'direct restore recovery is required',
        retryable: true,
        correlation_id: 'corr-restore-recovery',
        details: {
          repo_id: 'repo_hidden_elsewhere',
          namespace_id: 'ns_hidden',
          metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
        },
      },
    });

    expect(mapped).toEqual({
      status: 409,
      code: 'afscp_operator_recovery_required',
      message: 'afscp_operator_recovery_required',
      retryable: true,
      correlation_id: 'corr-restore-recovery',
    });
    expectNoSensitiveValues(mapped);
    expect(JSON.stringify(mapped)).not.toMatch(/ns_hidden|repo_hidden_elsewhere/);
  });

  it('maps restore writer blockers from operation and session families to one stable code', () => {
    for (const code of ['ACTIVE_WRITER_SESSIONS', 'STALE_WRITER_SESSION_UNCERTAIN', 'WRITER_SESSION_FENCE_HELD']) {
      const mapped = mapAfscpErrorEnvelope(409, {
        error: {
          code,
          message: `${code} repo_hidden_elsewhere`,
          retryable: true,
          correlation_id: 'corr-writer-blocker',
          details: {
            writer_gate_error_family: code,
            export_id: 'export_hidden',
            namespace_id: 'ns_hidden',
          },
        },
      });

      expect(mapped).toEqual({
        status: 409,
        code: 'afscp_active_writer_blocks_restore',
        message: 'afscp_active_writer_blocks_restore',
        retryable: true,
        correlation_id: 'corr-writer-blocker',
      });
      expect(JSON.stringify(mapped)).not.toMatch(/export_hidden|ns_hidden|repo_hidden_elsewhere/);
    }
  });

  it('does not infer public state from private JVS-shaped command payloads', () => {
    const mapped = mapAfscpErrorEnvelope(500, {
      error: {
        code: 'JVS_COMMAND_FAILED',
        message: 'save point failed for repo_hidden_elsewhere',
        retryable: false,
        correlation_id: 'corr-jvs-red-team',
        operation_id: 'op_save_point_private',
        details: {
          jvs_error_code: 'E_REPO_BUSY',
          jvs_stdout: 'jvs stdout leaked',
          repo_id: 'repo_hidden_elsewhere',
          namespace_id: 'ns_hidden',
          metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
        },
      },
      jvs_json_output: JSON.stringify({
        jvs_error_code: 'E_REPO_BUSY',
        repo_id: 'repo_hidden_elsewhere',
      }),
    });

    expect(mapped).toEqual({
      status: 500,
      code: 'afscp_error',
      message: 'afscp_error',
      retryable: false,
      correlation_id: 'corr-jvs-red-team',
      operation_id: 'op_save_point_private',
    });
    expect(JSON.stringify(mapped)).not.toMatch(/E_REPO_BUSY|jvs stdout leaked|repo_hidden_elsewhere|ns_hidden|metadata_url|postgres/);
  });

  it('maps repo mutation-in-progress conflicts to a retryable busy state without leaking details', () => {
    for (const [rawCode, mappedCode] of [
      ['REPO_MUTATION_IN_PROGRESS', 'afscp_repo_mutation_in_progress'],
      ['REPO_JVS_MUTATION_IN_PROGRESS', 'afscp_repo_mutation_in_progress'],
      ['FILE_LIBRARY_OPERATION_PENDING', 'afscp_repo_mutation_in_progress'],
    ] as const) {
      const mapped = mapAfscpErrorEnvelope(409, {
        error: {
          code: rawCode,
          message: rawCode === 'REPO_JVS_MUTATION_IN_PROGRESS'
            ? 'repo JVS mutation is in progress'
            : rawCode === 'FILE_LIBRARY_OPERATION_PENDING'
              ? 'file library operation is pending'
              : 'repo repo_hidden_elsewhere has an active mutation metadata_url=postgres://db',
          retryable: true,
          correlation_id: 'corr-mutation-busy',
          operation_id: 'op_repo_mutation_busy',
          details: {
            resource: { type: 'repo', id: 'repo_hidden_elsewhere' },
            namespace_id: 'ns_hidden',
            metadata_url: 'postgres://postgres:postgres@db:5432/juicefs',
          },
        },
      });

      expect(mapped).toEqual({
        status: 409,
        code: mappedCode,
        message: mappedCode,
        retryable: true,
        correlation_id: 'corr-mutation-busy',
        operation_id: 'op_repo_mutation_busy',
        resource_kind: 'repo',
      });
      expect(JSON.stringify(mapped)).not.toMatch(/REPO_JVS_MUTATION_IN_PROGRESS|FILE_LIBRARY_OPERATION_PENDING|repo JVS mutation is in progress|file library operation is pending|repo_hidden_elsewhere|ns_hidden|metadata_url|postgres/);
    }
  });

  it('maps file-library operation recovery-required conflicts without leaking details', () => {
    const mapped = mapAfscpErrorEnvelope(409, {
      error: {
        code: 'FILE_LIBRARY_OPERATION_REQUIRES_RECOVERY',
        message: 'file library operation op_private requires recovery',
        retryable: false,
        correlation_id: 'corr-operation-recovery',
        operation_id: 'op_private_recovery',
        details: {
          resource: { type: 'operation', id: 'op_private_recovery' },
          repo_id: 'repo_hidden_elsewhere',
          namespace_id: 'ns_hidden',
        },
      },
    });

    expect(mapped).toEqual({
      status: 409,
      code: 'afscp_operator_recovery_required',
      message: 'afscp_operator_recovery_required',
      retryable: false,
      correlation_id: 'corr-operation-recovery',
      operation_id: 'op_private_recovery',
      resource_kind: 'operation',
    });
    expect(JSON.stringify(mapped)).not.toMatch(/FILE_LIBRARY_OPERATION_REQUIRES_RECOVERY|file library operation op_private requires recovery|repo_hidden_elsewhere|ns_hidden/);
  });

  it('maps template clone and capability denials to stable non-leaking codes', () => {
    const cloneDenied = mapAfscpErrorEnvelope(403, {
      error: {
        code: 'RESOURCE_NAMESPACE_MISMATCH',
        message: 'cross-namespace template clone is not allowed for tmpl_hidden from ns_other',
        retryable: false,
        correlation_id: 'corr-template-clone',
        details: {
          validation_errors: ['cross_namespace_template_clone_denied'],
          template_id: 'tmpl_hidden',
          source_namespace_id: 'ns_other',
        },
      },
    });
    expect(cloneDenied).toEqual({
      status: 403,
      code: 'afscp_template_clone_not_allowed',
      message: 'afscp_template_clone_not_allowed',
      retryable: false,
      correlation_id: 'corr-template-clone',
    });

    const capabilityDenied = mapAfscpErrorEnvelope(403, {
      error: {
        code: 'CAPABILITY_DENIED',
        message: 'repo templates are disabled for namespace ns_hidden',
        retryable: false,
        correlation_id: 'corr-capability',
        details: {
          validation_errors: ['template_policy_disabled'],
          namespace_id: 'ns_hidden',
        },
      },
    });
    expect(capabilityDenied).toEqual({
      status: 403,
      code: 'afscp_capability_denied',
      message: 'afscp_capability_denied',
      retryable: false,
      correlation_id: 'corr-capability',
    });
    expect(JSON.stringify([cloneDenied, capabilityDenied])).not.toMatch(/tmpl_hidden|ns_other|ns_hidden/);
  });

  it('maps service permission and volume/configuration failures to admin-action stable codes', () => {
    for (const code of ['AUTHENTICATION_FAILED', 'CALLER_NOT_ALLOWED', 'ROLE_NOT_ALLOWED']) {
      expect(mapAfscpErrorEnvelope(403, {
        error: {
          code,
          message: `${code} token=secret-token-value`,
          retryable: false,
          correlation_id: 'corr-permission',
        },
      })).toEqual({
        status: 403,
        code: 'afscp_service_permission_denied',
        message: 'afscp_service_permission_denied',
        retryable: false,
        correlation_id: 'corr-permission',
      });
    }

    expect(mapAfscpErrorEnvelope(409, {
      error: {
        code: 'VOLUME_MISMATCH_REQUIRES_IMPORT',
        message: 'template volume does not match namespace default volume vol_secret',
        retryable: false,
        correlation_id: 'corr-volume',
        details: { volume_id: 'vol_secret', namespace_id: 'ns_hidden' },
      },
    })).toEqual({
      status: 409,
      code: 'afscp_volume_mismatch_requires_admin',
      message: 'afscp_volume_mismatch_requires_admin',
      retryable: false,
      correlation_id: 'corr-volume',
    });

    expect(mapAfscpErrorEnvelope(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'internal server error metadata_url=postgres://db',
        retryable: false,
        correlation_id: 'corr-config',
      },
    })).toEqual({
      status: 500,
      code: 'afscp_service_configuration_error',
      message: 'afscp_service_configuration_error',
      retryable: false,
      correlation_id: 'corr-config',
    });
  });

  it('falls back to a sanitized internal error for malformed envelopes', () => {
    const mapped = mapAfscpErrorEnvelope(500, {
      error: {
        message: 'JVS failed password=super-secret',
        details: { SecretRef: 'storage-root' },
      },
    });

    expect(mapped).toEqual({
      status: 500,
      code: 'afscp_error',
      message: 'afscp_error',
      retryable: false,
    });
    expectNoSensitiveValues(mapped);
  });
});

describe('AfscpClientError', () => {
  it('serializes only allowlisted metadata', () => {
    const error = new AfscpClientError({
      status: 404,
      code: 'afscp_resource_not_found',
      message: 'afscp_resource_not_found',
      retryable: false,
      correlation_id: 'corr-1',
      operation_id: 'op_123',
      resource_kind: 'repo',
    });

    expect(error.message).toBe('afscp_request_failed:afscp_resource_not_found');
    expect(JSON.stringify(error)).toBe(JSON.stringify({
      status: 404,
      code: 'afscp_resource_not_found',
      message: 'afscp_resource_not_found',
      retryable: false,
      correlation_id: 'corr-1',
      operation_id: 'op_123',
      resource_kind: 'repo',
    }));
  });
});

import { describe, expect, it } from 'vitest';
import {
  AfscpConfigError,
  parseAfscpConfig,
} from './afscp-config.js';

describe('parseAfscpConfig', () => {
  it('returns disabled when AFSCP is not configured', () => {
    expect(parseAfscpConfig({})).toEqual({ enabled: false });
    expect(parseAfscpConfig({
      AFSCP_BASE_URL: ' ',
      AFSCP_CALLER_SERVICE: '',
      AFSCP_SERVICE_TOKEN: '\t',
      AFSCP_BOOTSTRAP_SERVICE_TOKEN: '',
      AFSCP_DEFAULT_VOLUME_ID: '',
      AFSCP_BOOTSTRAP_CALLER_SERVICE: '',
      AFSCP_ORCHESTRATOR_CALLER_SERVICE: '',
    })).toEqual({ enabled: false });
  });

  it('normalizes the base URL and trims configured values', () => {
    expect(parseAfscpConfig({
      AFSCP_BASE_URL: ' https://afscp.internal/api/// ',
      AFSCP_CALLER_SERVICE: ' agentsmith-api ',
      AFSCP_SERVICE_TOKEN: ' svc-token ',
      AFSCP_BOOTSTRAP_SERVICE_TOKEN: ' bootstrap-svc-token ',
      AFSCP_DEFAULT_VOLUME_ID: ' vol_shared ',
      AFSCP_BOOTSTRAP_CALLER_SERVICE: ' agentsmith-bootstrap ',
      AFSCP_ORCHESTRATOR_CALLER_SERVICE: ' agentsmith-sandbox-control-plane ',
    })).toEqual({
      enabled: true,
      baseUrl: 'https://afscp.internal/api',
      callerService: 'agentsmith-api',
      serviceToken: 'svc-token',
      bootstrapServiceToken: 'bootstrap-svc-token',
      defaultVolumeId: 'vol_shared',
      bootstrapCallerService: 'agentsmith-bootstrap',
      orchestratorCallerService: 'agentsmith-sandbox-control-plane',
    });
  });

  it('throws a stable non-leaking error when required config is partial', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_SERVICE_TOKEN: 'secret-token-value',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INCOMPLETE',
      missing: [
        'AFSCP_CALLER_SERVICE',
        'AFSCP_BOOTSTRAP_SERVICE_TOKEN',
        'AFSCP_DEFAULT_VOLUME_ID',
        'AFSCP_BOOTSTRAP_CALLER_SERVICE',
        'AFSCP_ORCHESTRATOR_CALLER_SERVICE',
      ],
    });
    const serialized = `${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain('secret-token-value');
  });

  it('treats bootstrap-only config as incomplete instead of enabled', () => {
    expect(() => parseAfscpConfig({
      AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
    })).toThrow(AfscpConfigError);
  });

  it('throws a stable non-leaking error for invalid base URLs', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'not a url with svc-token',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BASE_URL'],
    });
    const serialized = `${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain('svc-token');
    expect(serialized).not.toContain('not a url');
  });

  it('requires bootstrap caller separation without exposing token values', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_CALLER_SERVICE'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('svc-token');
  });

  it('requires product and bootstrap service tokens to be distinct', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'same-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'same-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_SERVICE_TOKEN'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('same-token');
  });

  it('validates the default AFSCP volume id shape before wiring bootstrap storage', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'volume shared\r\nx-token=svc-token',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_DEFAULT_VOLUME_ID'],
    });
    const serialized = `${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain('volume shared');
    expect(serialized).not.toContain('svc-token');
  });

  it('requires a separate bootstrap service token', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INCOMPLETE',
      missing: ['AFSCP_BOOTSTRAP_SERVICE_TOKEN'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('svc-token');
  });

  it('rejects unsafe caller service names before they can become headers', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api\r\nx-token=svc-token',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-sandbox-control-plane',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_CALLER_SERVICE'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('svc-token');
  });

  it('requires an orchestrator caller service distinct from the product caller', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-api',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_ORCHESTRATOR_CALLER_SERVICE'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('svc-token');
  });

  it('requires an orchestrator caller service distinct from the bootstrap caller', () => {
    let caught: unknown;
    try {
      parseAfscpConfig({
        AFSCP_BASE_URL: 'https://afscp.internal',
        AFSCP_CALLER_SERVICE: 'agentsmith-api',
        AFSCP_SERVICE_TOKEN: 'svc-token',
        AFSCP_BOOTSTRAP_SERVICE_TOKEN: 'bootstrap-svc-token',
        AFSCP_DEFAULT_VOLUME_ID: 'vol_shared',
        AFSCP_BOOTSTRAP_CALLER_SERVICE: 'agentsmith-bootstrap',
        AFSCP_ORCHESTRATOR_CALLER_SERVICE: 'agentsmith-bootstrap',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_ORCHESTRATOR_CALLER_SERVICE'],
    });
    expect(`${caught instanceof Error ? caught.message : ''} ${JSON.stringify(caught)}`).not.toContain('svc-token');
  });
});

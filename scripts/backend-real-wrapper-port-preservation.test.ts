import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type WrapperPortContract = {
  scriptPath: string;
  apiResolution: string;
  webResolution: string;
};

const wrapperPortContracts: WrapperPortContract[] = [
  {
    scriptPath: 'scripts/notebook-real-smoke-gate.sh',
    apiResolution: 'API_PORT="${INTEGRATION_API_PORT:-20060}"',
    webResolution: 'WEB_PORT="${INTEGRATION_WEB_PORT:-3061}"',
  },
  {
    scriptPath: 'scripts/backend-real-visual-review.sh',
    apiResolution: 'API_PORT="${INTEGRATION_API_PORT:-20070}"',
    webResolution: 'WEB_PORT="${INTEGRATION_WEB_PORT:-3071}"',
  },
  {
    scriptPath: 'scripts/run-internal-chat-real-gate.sh',
    apiResolution: 'API_PORT="${INTEGRATION_API_PORT:-20064}"',
    webResolution: 'WEB_PORT="${INTEGRATION_WEB_PORT:-3065}"',
  },
  {
    scriptPath: 'scripts/run-internal-notebook-real-gate.sh',
    apiResolution: 'API_PORT="${INTEGRATION_API_PORT:-20072}"',
    webResolution: 'WEB_PORT="${INTEGRATION_WEB_PORT:-3072}"',
  },
];

describe('backend-real wrapper port preservation contract', () => {
  it.each(wrapperPortContracts)(
    'restores caller-selected integration ports after backend-real env load in $scriptPath',
    ({ scriptPath, apiResolution, webResolution }) => {
      const script = readFileSync(scriptPath, 'utf8');

      const originalApiCapture = 'ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"';
      const originalWebCapture = 'ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"';
      const runtimeLoad = 'load_backend_real_env';
      const restoreApi = 'export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"';
      const restoreWeb = 'export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"';

      expect(script).toContain(originalApiCapture);
      expect(script).toContain(originalWebCapture);
      expect(script).toContain(restoreApi);
      expect(script).toContain(restoreWeb);

      expect(script.indexOf(originalApiCapture)).toBeLessThan(script.indexOf(runtimeLoad));
      expect(script.indexOf(originalWebCapture)).toBeLessThan(script.indexOf(runtimeLoad));
      expect(script.indexOf(restoreApi)).toBeGreaterThan(script.indexOf(runtimeLoad));
      expect(script.indexOf(restoreWeb)).toBeGreaterThan(script.indexOf(runtimeLoad));
      expect(script.indexOf(restoreApi)).toBeLessThan(script.indexOf(apiResolution));
      expect(script.indexOf(restoreWeb)).toBeLessThan(script.indexOf(webResolution));
    },
  );

  it('does not interpolate backend-real API keys into command strings that are echoed by wrappers', () => {
    const scriptPaths = [
      'scripts/notebook-real-smoke-gate.sh',
      'scripts/backend-real-visual-review.sh',
      'scripts/backend-real-full-gate.sh',
    ];

    for (const scriptPath of scriptPaths) {
      const script = readFileSync(scriptPath, 'utf8');

      expect(script, scriptPath).not.toContain("BACKEND_REAL_API_KEY='${BACKEND_REAL_API_KEY_VALUE}'");
    }
  });
});

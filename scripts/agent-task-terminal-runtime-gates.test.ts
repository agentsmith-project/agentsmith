import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog } from './story-catalog-support';
import { loadStoryDefinitionSync } from '../e2e/story-loader';
import { buildTraceStoryBinding, bindTraceEventToStory } from '../e2e/story-trace-binding';

type TerminalUxTraceCaptureEvent = {
  stepId: string;
  action?: string;
  target?: string;
};

function extractBlockBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`missing block: ${marker}`);
  }

  let depth = 0;
  let bodyStart = -1;
  for (let index = start + marker.length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      if (bodyStart === -1) {
        bodyStart = index + 1;
      }
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index);
      }
    }
  }

  throw new Error(`unterminated block: ${marker}`);
}

function extractFunctionBody(source: string, functionName: string): string {
  const signature = `${functionName}() {`;
  return extractBlockBody(source, signature);
}

function extractShellFunctionBody(source: string, functionName: string): string {
  return extractBlockBody(source, `${functionName}() {`);
}

function findRequiredTrimmedLineIndex(source: string, expectedLine: string): number {
  const index = source.split(/\r?\n/).findIndex((line) => line.trim() === expectedLine);
  expect(index, `missing line: ${expectedLine}`).toBeGreaterThanOrEqual(0);
  return index;
}

function extractMakeTargetBody(source: string, target: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${target}:` || line.startsWith(`${target}:`));
  if (start === -1) {
    throw new Error(`missing Makefile target: ${target}`);
  }

  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line && !line.startsWith('\t') && /^[A-Za-z0-9_.-]+:/u.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

function extractCaptureBlocks(source: string, traceName: string): string[] {
  const marker = `await ${traceName}.capture(page, {`;
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(marker, cursor);
    if (start === -1) {
      break;
    }

    let depth = 0;
    let bodyStart = -1;
    let blockEnd = -1;
    for (let index = start + marker.length - 1; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') {
        depth += 1;
        if (bodyStart === -1) {
          bodyStart = index + 1;
        }
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          blockEnd = index;
          break;
        }
      }
    }

    if (bodyStart === -1 || blockEnd === -1) {
      throw new Error(`unterminated trace capture block: ${traceName}`);
    }

    blocks.push(source.slice(bodyStart, blockEnd));
    cursor = blockEnd + 1;
  }

  return blocks;
}

function extractSingleQuotedProperty(source: string, propertyName: string): string | undefined {
  const match = new RegExp(`${propertyName}: '([^']+)'`).exec(source);
  return match?.[1];
}

function extractTerminalUxTraceCaptureEvents(source: string, traceName: string): TerminalUxTraceCaptureEvent[] {
  return extractCaptureBlocks(source, traceName).map((block) => {
    const stepId = extractSingleQuotedProperty(block, 'stepId');
    if (!stepId) {
      throw new Error(`trace capture missing stepId: ${traceName}`);
    }
    return {
      stepId,
      action: extractSingleQuotedProperty(block, 'action'),
      target: extractSingleQuotedProperty(block, 'target'),
    };
  });
}

describe('Agent Task terminal runtime gates', () => {
  it('keeps real terminal smokes aligned with the browser-facing ready handshake', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      const openSessionBody = extractBlockBody(source, 'async function openSession({ label }) {');
      const openHandlerBody = extractBlockBody(openSessionBody, "ws.on('open', () => {");
      const readyHandshakeBody = extractBlockBody(source, 'function isTerminalReadyHandshake(message) {');

      expect(source).toContain('function isTerminalReadyHandshake(message)');
      expect(source).toContain("message.type === 'terminal.state'");
      expect(source).toContain("message.type === 'terminal.replay_end'");
      expect(source).toContain('message.input_enabled === true');
      expect(source).toContain("terminalState === 'ready' || terminalState === 'active' || terminalState === 'connected'");
      expect(source).toContain("terminalState === 'recovering' || terminalState === 'starting' || terminalState === 'pending'");
      expect(source).toContain("terminalState === 'failed' || terminalState === 'unavailable'");
      expect(source).toContain("message.type === 'terminal.output'");
      expect(openSessionBody.indexOf("ws.on('open', () => {")).toBeLessThan(
        openSessionBody.indexOf("ws.on('message', (buffer) => {"),
      );
      expect(openHandlerBody).toContain('ws.send(JSON.stringify({');
      expect(openHandlerBody).toContain("type: 'terminal.reconnect'");
      expect(openHandlerBody).toContain('terminal_session_id: terminalSessionId');
      expect(openHandlerBody).toContain('cols: terminalCols');
      expect(openHandlerBody).toContain('rows: terminalRows');
      expect(openSessionBody.match(/if \(resolved\) return;/g) ?? []).toHaveLength(1);
      expect(readyHandshakeBody).not.toContain("message.type === 'started'");
      expect(openSessionBody).not.toContain('sawStarted');
      expect(source).not.toContain(
        "if (message.type === 'started') {\n          state.sawStarted = true;\n          clearTimeout(deadline);\n          resolve({",
      );
    }
  });

  it('keeps the external and internal smokes focused on multi-session coexistence and task release', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      expect(source).toContain('/terminal/sessions');
      expect(source).toContain('session-one');
      expect(source).toContain('session-two');
      expect(source).toContain('SESSION_VAR_SECOND=unset');
      expect(source).toContain("method: 'GET'");
      expect(source).toContain("method: 'DELETE'");
      expect(source).toContain('remaining_after_first_close');
      expect(source).toContain('remaining_after_last_close');
      expect(source).toContain('task released after last terminal session');
    }

    expect(externalSmoke).toContain('const expectedWorkspaceRoot = resolveExpectedWorkspaceRoot();');
    expect(externalSmoke).toContain('TASK_HOME_SEGMENT');
    expect(externalSmoke).toContain('TASK_HOME_PATH');
    expect(externalSmoke).toContain('MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT');
    expect(externalSmoke).toContain("fail('session_one_forbidden_host_home_path'");
    expect(externalSmoke).not.toContain("const expectedWorkspaceRoot = `${process.env.HOME || ''}/ags-workspace/${taskId}`;");
    expect(externalSmoke).not.toContain('/home/percy/ags-workspaces/');
    expect(externalSmoke).not.toContain("&& !first.state.output.includes('/workspace')");
  });

  it('reads terminal session ids from the list API contract field before the legacy fallback', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      const listedSessionIdReader = extractBlockBody(
        source,
        'function readListedTerminalSessionId(item) {',
      );

      expect(listedSessionIdReader).toContain('item.terminal_session_id');
      expect(listedSessionIdReader).toContain('item.id');
      expect(listedSessionIdReader.indexOf('item.terminal_session_id')).toBeLessThan(
        listedSessionIdReader.indexOf('item.id'),
      );
      expect(source).toContain('.map(readListedTerminalSessionId)');
      expect(source).toContain(
        'const remainingSessionId = readListedTerminalSessionId(remainingAfterFirstClose?.items?.[0]);',
      );
      expect(source).not.toContain('.map((item) => item.id)');
      expect(source).not.toContain('items?.[0]?.id');
    }
  });

  it('treats browser socket close as browser evidence and polls API close truth for final signoff', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      expect(source).toContain('async function readTerminalSessionTruth(sessionId)');
      expect(source).toContain('async function readSessionListForTruth()');
      expect(source).toContain('async function waitForSessionFinalTruth(sessionId, label)');
      expect(source).toContain('function isTerminalSessionFinalTruth(truth)');
      expect(source).toContain('terminal_session_close_truth_timeout');
      expect(source).toContain('last_session_truth');
      expect(source).toContain('list_status');
      expect(source).toContain('close_state');
      expect(source).toContain('close_result');
      expect(source).toContain('close_deadline_at');
      expect(source).toContain('close_attempt_id');
      expect(source).toContain('failure_kind');
      expect(source).toContain('close_reason');
      expect(source).not.toContain("closeState === 'closed'");
      expect(source).not.toContain("closeState === 'failed'");
      expect(source).not.toContain('deadline_expired');
      expect(source).not.toContain('close_ack_status');
      expect(source).not.toContain('close_diagnostic_code');
      expect(source).not.toContain('close_diagnostic');
      expect(source).toContain('async waitForBrowserSocketClosed(timeoutMs = 10_000)');
      expect(source).toContain('const firstCloseTruth = await waitForSessionFinalTruth(first.sessionId,');
      expect(source).toContain('const secondCloseTruth = await waitForSessionFinalTruth(second.sessionId,');
      expect(source).toContain('browser_socket_closed:');
      expect(source).not.toContain('async waitForClosed(');
      expect(source).not.toContain('await first.waitForClosed()');
      expect(source).not.toContain('await second.waitForClosed()');

      const firstDeleteIndex = source.indexOf('await deleteSession(first.sessionId);');
      const firstFinalTruthIndex = source.indexOf('const firstCloseTruth = await waitForSessionFinalTruth(first.sessionId,');
      const firstRemainingListIndex = source.indexOf('const remainingAfterFirstClose = await listSessions();');
      expect(firstDeleteIndex).toBeGreaterThanOrEqual(0);
      expect(firstFinalTruthIndex).toBeGreaterThan(firstDeleteIndex);
      expect(firstFinalTruthIndex).toBeLessThan(firstRemainingListIndex);
    }
  });

  it('uses marker-scoped foreground commands and proves the marker process exits after close', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      expect(source).toContain('function makeCloseMarker(label)');
      expect(source).toContain('function findMarkerProcesses(marker)');
      expect(source).toContain('async function waitForMarkerProcessPresent(marker, label');
      expect(source).toContain('async function waitForMarkerProcessGone(marker, label');
      expect(source).toContain('exec -a ${marker} sleep 120');
      expect(source).toContain("makeCloseMarker('session-one')");
      expect(source).toContain("makeCloseMarker('session-two')");
      expect(source).toContain('await waitForMarkerProcessPresent(firstMarker,');
      expect(source).toContain('await waitForMarkerProcessGone(firstMarker,');
      expect(source).toContain('await waitForMarkerProcessGone(secondMarker,');
      expect(source).toContain('SESSION_TWO_STILL_ACTIVE');
      expect(source).not.toContain('pgrep -f sleep 120');
      expect(source).not.toContain('sleep 120\\n');
    }

    expect(externalSmoke).toContain("execFileSync('ps', ['-eo', 'pid=,ppid=,args=']");
    expect(internalSmoke).toContain('const podName = process.env.POD_NAME ||');
    expect(internalSmoke).toContain("execFileSync('kubectl', [");
    expect(internalSmoke).toContain("'exec',");
    expect(internalSmoke).toContain("'--',");
    expect(internalSmoke).toContain("'ps',");
    expect(internalSmoke).toContain("export TOKEN API_BASE TASK_WS_ID TASK_PROJECT_ID=\"${PROJECT_ID}\" TASK_ID POD_NAME K8S_NAMESPACE");
  });

  it('classifies managed marker probes so only last-close workload release counts as process gone evidence', async () => {
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    expect(internalSmoke).toContain('function probeMarkerProcesses(marker, label)');
    expect(internalSmoke).toContain('function isWorkloadGoneKubectlExecError(stderr)');
    expect(internalSmoke).toContain("classification: 'present'");
    expect(internalSmoke).toContain("classification: 'absent'");
    expect(internalSmoke).toContain("classification: 'workload_gone'");
    expect(internalSmoke).toContain("classification: 'exec_error'");
    expect(internalSmoke).toContain('/\\bpod\\b.*\\bnot found\\b/i');
    expect(internalSmoke).toContain('/\\bcontainer\\b.*\\bnot found\\b/i');
    expect(internalSmoke).toContain('/\\btask\\b.*\\bnot found\\b/i');
    expect(internalSmoke).toContain('/\\bcontainer\\b.*\\bnot running\\b/i');
    expect(internalSmoke).toContain("fail('marker_process_workload_gone_before_observed'");
    expect(internalSmoke).toContain("fail('workload_gone_with_live_terminal_session'");
    expect(internalSmoke).toContain("fail('workload_gone_without_final_session_truth'");
    expect(internalSmoke).toContain('expectedRemainingSessions === 0');
    expect(internalSmoke).toContain('isTerminalSessionFinalTruth(finalTruth)');
    expect(internalSmoke).toContain('probe_classification');
    expect(internalSmoke).toContain('pod_name: podName');
    expect(internalSmoke).toContain('label');

    const firstDeleteIndex = internalSmoke.indexOf('await deleteSession(first.sessionId);');
    const firstFinalTruthIndex = internalSmoke.indexOf('const firstCloseTruth = await waitForSessionFinalTruth(first.sessionId,');
    const firstRemainingListIndex = internalSmoke.indexOf('const remainingAfterFirstClose = await listSessions();');
    const firstMarkerGoneIndex = internalSmoke.indexOf('const firstGoneProbe = await waitForMarkerProcessGone(firstMarker, {');
    expect(firstDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(firstFinalTruthIndex).toBeGreaterThan(firstDeleteIndex);
    expect(firstRemainingListIndex).toBeGreaterThan(firstFinalTruthIndex);
    expect(firstMarkerGoneIndex).toBeGreaterThan(firstRemainingListIndex);
    expect(internalSmoke).toContain('expectedRemainingSessions: remainingAfterFirstClose?.total');
    expect(internalSmoke).toContain('liveTerminalSessionId: second.sessionId');

    const secondDeleteIndex = internalSmoke.indexOf('await deleteSession(second.sessionId);');
    const secondFinalTruthIndex = internalSmoke.indexOf('const secondCloseTruth = await waitForSessionFinalTruth(second.sessionId,');
    const secondRemainingListIndex = internalSmoke.indexOf('const remainingAfterLastClose = await listSessions();');
    const secondMarkerGoneIndex = internalSmoke.indexOf('const secondGoneProbe = await waitForMarkerProcessGone(secondMarker, {');
    expect(secondDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(secondFinalTruthIndex).toBeGreaterThan(secondDeleteIndex);
    expect(secondRemainingListIndex).toBeGreaterThan(secondFinalTruthIndex);
    expect(secondMarkerGoneIndex).toBeGreaterThan(secondRemainingListIndex);
    expect(internalSmoke).toContain('expectedRemainingSessions: remainingAfterLastClose?.total');
    expect(internalSmoke).toContain('finalTruth: secondCloseTruth');
  });

  it('locates internal managed workload pods by current ASBCP label truth without exact workload_id matching', async () => {
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );
    const localManualInternalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-smoke.sh'),
      'utf-8',
    );
    const selector = await readFile(
      path.resolve(process.cwd(), 'scripts/lib/agent-task-workload-pod-selector.mjs'),
      'utf-8',
    );

    expect(internalSmoke).toContain('scripts/lib/agent-task-workload-pod-selector.mjs');
    expect(internalSmoke).toContain('TASK_WORKLOAD_ID="$(node "${ROOT_DIR}/scripts/lib/agent-task-workload-pod-selector.mjs" --sanitize "${TASK_ID}")"');
    expect(internalSmoke).toContain('-l "app=managed-workload" -o json');
    expect(internalSmoke).toContain('workload_pod_selector_error');
    expect(internalSmoke).toContain('pod_selector=app=managed-workload');
    expect(internalSmoke).toContain('workload_id_prefix=${TASK_WORKLOAD_ID}');
    expect(internalSmoke).not.toContain('expected_pod=workload-${TASK_WORKLOAD_ID}');
    expect(internalSmoke).not.toContain('-l "workload_id=${WORKLOAD_ID}"');
    expect(internalSmoke).not.toContain("jsonpath='{.items[0].metadata.name}'");

    expect(localManualInternalSmoke).toContain('scripts/lib/agent-task-workload-pod-selector.mjs');
    expect(localManualInternalSmoke).toContain('WORKLOAD_ID="$(node "${ROOT_DIR}/scripts/lib/agent-task-workload-pod-selector.mjs" --sanitize "${TASK_ID}")"');
    expect(localManualInternalSmoke).toContain('-l "app=managed-workload" -o json');
    expect(localManualInternalSmoke).toContain('workload_pod_selector_error');
    expect(localManualInternalSmoke).toContain('pod_selector=app=managed-workload');
    expect(localManualInternalSmoke).toContain('workload_id_prefix=${WORKLOAD_ID}');
    expect(localManualInternalSmoke).not.toContain('expected_pod=workload-${WORKLOAD_ID}');
    expect(localManualInternalSmoke).not.toContain('-l "workload_id=${WORKLOAD_ID}"');
    expect(localManualInternalSmoke).not.toContain("jsonpath='{.items[0].metadata.name}'");

    expect(selector).toContain("item.app === 'managed-workload'");
    expect(selector).toContain('isDerivedLabelId(item.workspaceId, workspaceId)');
    expect(selector).toContain('isDerivedLabelId(item.projectId, projectId)');
    expect(selector).not.toContain('expectedPodName');
    expect(selector).not.toContain('item.podName === expectedPodName');
    expect(selector).toContain('isTaskWorkloadId(item.workloadId, taskWorkloadId)');
    expect(selector).toContain('labelId === sourceId');
    expect(selector).toContain('labelId === sanitized');
    expect(selector).toContain('labelId.startsWith(`${sanitized}-`)');
    expect(selector).toContain('workloadId === taskWorkloadId || workloadId.startsWith(`${taskWorkloadId}-`)');
  });

  it('initializes internal terminal smoke POD_NAME before polling under set -u', async () => {
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    const podNameInitLine = findRequiredTrimmedLineIndex(internalSmoke, 'POD_NAME=""');
    const pollLoopLine = findRequiredTrimmedLineIndex(internalSmoke, 'for _ in $(seq 1 90); do');
    const firstPodNameReadLine = findRequiredTrimmedLineIndex(internalSmoke, 'if [[ -n "${POD_NAME}" ]]; then');
    const fallbackCheckLine = findRequiredTrimmedLineIndex(internalSmoke, 'if [[ -z "${POD_NAME:-}" ]]; then');

    expect(podNameInitLine).toBeLessThan(pollLoopLine);
    expect(pollLoopLine).toBeLessThan(firstPodNameReadLine);
    expect(firstPodNameReadLine).toBeLessThan(fallbackCheckLine);
  });

  it('documents local-real internal sandbox startup as ensuring managed Agent task diagnostic state', async () => {
    const development = await readFile(
      path.resolve(process.cwd(), 'DEVELOPMENT.md'),
      'utf-8',
    );

    expect(development).toContain('internal sandbox 启动前会确保 managed Agent task diagnostic state');
    expect(development).toContain('它不会启动本机 Developer runner 诊断进程');
    expect(development).toContain('这一步启动平台、拉起 internal sandbox，并在 internal sandbox 启动前确保 managed Agent task diagnostic state');
    expect(development).toContain('AGENT_RUNNER_SEED_MODE=managed_agent_task LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0');
    expect(development).not.toContain('仍不自动创建 Agent task 诊断资源');
    expect(development).not.toContain('不自动创建 Agent task 诊断资源');
  });

  it('keeps local-real reset managed-only without starting the local Developer runner diagnostics process', async () => {
    const makefile = await readFile(
      path.resolve(process.cwd(), 'Makefile'),
      'utf-8',
    );
    const internalCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-common.sh'),
      'utf-8',
    );

    const localManualReset = extractMakeTargetBody(makefile, 'local-manual-reset');
    const localRealUp = extractMakeTargetBody(makefile, 'local-real-up');
    const localRealReset = extractMakeTargetBody(makefile, 'local-real-reset');
    const ensureInternalRunnerState = extractShellFunctionBody(internalCommon, 'ensure_internal_runner_state');

    expect(localManualReset).toContain('$(MAKE) local-manual-seed-agent-task');
    expect(localRealUp).toContain('LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0 $(MAKE) local-manual-internal-up');
    expect(localRealReset).not.toContain('$(MAKE) local-manual-reset');
    expect(localRealReset).toContain('$(MAKE) substrate-reset SUBSTRATE=local-dev');
    expect(localRealReset).toContain('$(MAKE) substrate-up SUBSTRATE=local-dev');
    expect(localRealReset).toContain('$(MAKE) substrate-reseed SUBSTRATE=local-dev');
    expect(localRealReset).toContain('$(MAKE) local-manual-up');
    expect(localRealReset).toContain('AGENT_RUNNER_SEED_MODE=managed_agent_task');
    expect(localRealReset).toContain('LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0');
    expect(localRealReset).toContain('$(MAKE) local-manual-seed-agent-task');
    expect(localRealReset).toContain('$(MAKE) local-manual-internal-up');
    expect(localRealReset.indexOf('AGENT_RUNNER_SEED_MODE=managed_agent_task')).toBeLessThan(
      localRealReset.indexOf('$(MAKE) local-manual-internal-up'),
    );
    expect(ensureInternalRunnerState).toContain('LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER:-1');
    expect(ensureInternalRunnerState).toContain('ensure_local_manual_runner_connected');
    expect(ensureInternalRunnerState).toContain('skipping local Developer runner diagnostics process startup');
  });

  it('runs the runtime matrix before the UX gate so UI evidence sits on top of terminal session truth', async () => {
    const uxGate = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-ux-real-gate.sh'),
      'utf-8',
    );
    const matrixGate = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-matrix-real-gate.sh'),
      'utf-8',
    );

    expect(uxGate).toContain('scripts/agent-task-terminal-matrix-real-gate.sh');
    expect(uxGate).not.toContain('scripts/agent-task-terminal-internal-real-smoke.sh');
    expect(uxGate).toContain('npx playwright test --config playwright.config.integration.ts e2e/integration-agent-task-terminal-ux.spec.ts');
    expect(uxGate).toContain('scripts/local-manual/down.sh');
    expect(uxGate).toContain('trap');
    expect(matrixGate).toContain('external_terminal_smoke');
    expect(matrixGate).toContain('internal_terminal_smoke');
    expect(matrixGate).toContain('multi-session');
    expect(matrixGate).toContain('AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE="${AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE:-developer_runner}"');
    expect(matrixGate).toContain('case "${AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE}" in');
    expect(matrixGate).toContain('developer_runner|developer|external)');
    expect(matrixGate).toContain('managed_agent_task|managed|internal)');
    expect(matrixGate).toContain('finish_matrix_in_final_posture');
    expect(matrixGate).toContain('keeping managed terminal runtime posture for downstream UX recovery gate');
    expect(matrixGate).toContain('AGENT_RUNNER_SEED_MODE=managed_agent_task');
    expect(matrixGate).toContain('source "${ROOT_DIR}/scripts/local-manual/common.sh"');
    expect(matrixGate).toContain('local_manual_platform_is_ready');
    expect(matrixGate).not.toContain('scripts/juicefs-orphan-preflight.ts');
    expect(matrixGate).toContain('internal_runtime_ready_for_retry()');
    expect(matrixGate).toContain('run_internal_terminal_smoke()');
    expect(matrixGate).toContain('bash scripts/local-manual/internal-down.sh >/dev/null');
    expect(matrixGate).toContain("grep -q '^Internal mode: enabled$'");
    expect(matrixGate).toContain("grep -q '^Runner socket: connected$'");
    expect(matrixGate).toContain('internal state missing before retry; rebuilding local-manual internal runtime');
    expect(matrixGate).toContain('scripts/local-manual/down.sh');
    expect(matrixGate).toContain('trap');
    expect(matrixGate).toContain('local-manual platform missing; starting it before preparing agent-task diagnostics');
    expect(matrixGate).toContain('scripts/local-manual/up.sh');
    expect(matrixGate).not.toContain('local-manual/proxy.ready');
    expect(matrixGate.indexOf('bash scripts/local-manual/seed-agent-task-diagnostics.sh')).toBeGreaterThanOrEqual(0);
    expect(matrixGate.indexOf('bash scripts/local-manual/start-runner.sh')).toBeGreaterThanOrEqual(0);
    expect(matrixGate.indexOf('bash scripts/local-manual/seed-agent-task-diagnostics.sh')).toBeLessThan(
      matrixGate.indexOf('bash scripts/local-manual/start-runner.sh'),
    );
    expect(matrixGate.lastIndexOf('finish_matrix_in_final_posture')).toBeGreaterThan(
      matrixGate.indexOf('run_with_retry internal_terminal_smoke run_internal_terminal_smoke'),
    );
    expect(matrixGate).not.toContain('if [[ "${label}" == "external_terminal_smoke" ]]; then');
    expect(matrixGate).not.toContain("seed-agent-task-diagnostics.sh >/dev/null 2>&1 || true");
    expect(matrixGate).not.toContain('run_with_retry internal_terminal_smoke env SKIP_INTERNAL_UP=1 bash scripts/agent-task-terminal-internal-real-smoke.sh');
  });

  it('rehydrates local-manual env for UX Playwright after the runtime matrix', async () => {
    const uxGate = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-ux-real-gate.sh'),
      'utf-8',
    );

    const matrixLine = findRequiredTrimmedLineIndex(
      uxGate,
      'AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE=managed_agent_task bash "${ROOT_DIR}/scripts/agent-task-terminal-matrix-real-gate.sh"',
    );
    const initEnvLine = findRequiredTrimmedLineIndex(uxGate, 'init_local_manual_env');
    const mongoUrlRequiredLine = findRequiredTrimmedLineIndex(uxGate, 'if [[ -z "${MONGO_URL:-}" ]]; then');
    const mongoDbNameExportLine = findRequiredTrimmedLineIndex(
      uxGate,
      'export MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"',
    );
    const mongoUrlExportLine = findRequiredTrimmedLineIndex(uxGate, 'export MONGO_URL');
    const baseUrlExportLine = findRequiredTrimmedLineIndex(
      uxGate,
      'export BASE_URL="${BASE_URL:-http://localhost:${PORT_WEB}}"',
    );
    const integrationApiBaseExportLine = findRequiredTrimmedLineIndex(
      uxGate,
      'export INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:${PORT_API}}"',
    );
    const playwrightLine = findRequiredTrimmedLineIndex(
      uxGate,
      'npx playwright test --config playwright.config.integration.ts e2e/integration-agent-task-terminal-ux.spec.ts --project=chromium --workers=1',
    );

    expect(matrixLine).toBeLessThan(initEnvLine);
    for (const line of [
      mongoUrlRequiredLine,
      mongoDbNameExportLine,
      mongoUrlExportLine,
      baseUrlExportLine,
      integrationApiBaseExportLine,
    ]) {
      expect(initEnvLine).toBeLessThan(line);
      expect(line).toBeLessThan(playwrightLine);
    }
    expect(mongoUrlRequiredLine).toBeLessThan(mongoUrlExportLine);
    expect(uxGate).toContain('backend_real_mongo_url_missing');
    expect(uxGate.split(/\r?\n/).map((line) => line.trim())).not.toContain(
      'bash "${ROOT_DIR}/scripts/agent-task-terminal-matrix-real-gate.sh"',
    );
    expect(uxGate).not.toContain('summary.env');
    expect(uxGate).not.toContain('http://localhost:3101');
    expect(uxGate).not.toContain('http://localhost:21000');
    expect(uxGate).not.toContain('MONGO_URL="${MONGO_URL:-mongodb://');
  });

  it('starts the local manual runner from backend-real state instead of requiring raw runner env', async () => {
    const startRunner = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/start-runner.sh'),
      'utf-8',
    );
    const localManualCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/common.sh'),
      'utf-8',
    );
    const stopProcesses = extractFunctionBody(localManualCommon, 'stop_local_manual_processes');

    expect(startRunner).toContain('make agent-task-runner-from-state');
    expect(startRunner).not.toContain('exec make notebook-runner');
    expect(startRunner).not.toContain("stop_matching_processes 'make agent-task-runner-from-state'");
    expect(startRunner).toContain('trap');
    expect(startRunner).toContain('stop_local_manual_runner_owner_aware');
    expect(startRunner).toContain('runner ownership is unverified');
    expect(startRunner).toContain("MBOS_AGENT_TASK_RUNNER_MODE='developer'");
    expect(startRunner).toContain("MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT='${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}'");
    expect(startRunner).toContain("MBOS_AGENT_WORKSPACE_ROOT='${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}'");
    expect(startRunner).not.toContain("MBOS_AGENT_TASK_RUNNER_MODE='managed_platform'");
    expect(startRunner).toContain('wait_runner_api_runtime_ready');
    expect(startRunner).toContain('/agent-runners/${runner_id}/diagnostics');
    expect(startRunner).toContain('runtime_metadata.ready_at');
    expect(localManualCommon).toContain('owner-janitor.ts');
    expect(localManualCommon).toContain('LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE');
    expect(stopProcesses).toContain('stop_local_manual_runner_owner_aware');
    expect(stopProcesses).not.toContain('stop_matching_processes');
    expect(stopProcesses).not.toContain('stop_listeners_on_port');
  });

  it('seeds local-manual external diagnostics as a Developer runner and keeps managed seed explicit', async () => {
    const seedDiagnostics = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/seed-agent-task-diagnostics.sh'),
      'utf-8',
    );
    const initResources = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-runner-init-resources.sh'),
      'utf-8',
    );
    const runnerEnvResolver = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-runner-resolve-managed-runner-env.ts'),
      'utf-8',
    );
    const makefile = await readFile(
      path.resolve(process.cwd(), 'Makefile'),
      'utf-8',
    );

    expect(seedDiagnostics).toContain('AGENT_RUNNER_SEED_MODE="${AGENT_RUNNER_SEED_MODE:-developer_runner}"');
    expect(initResources).toContain('AGENT_RUNNER_SEED_MODE="${AGENT_RUNNER_SEED_MODE:-developer_runner}"');
    expect(initResources).toContain('agent-runner-seed-developer-runner.ts');
    expect(initResources).toContain('agent-runner-seed-managed-runner.ts');
    expect(initResources).toContain('case "${AGENT_RUNNER_SEED_MODE}" in');
    expect(initResources).toContain('developer_runner|developer|external)');
    expect(initResources).toContain('managed_agent_task|managed|internal)');
    expect(initResources).toContain('PROJECT_ID="${PROJECT_ID}"');
    expect(initResources).toContain('ENDPOINT_ID="${ENDPOINT_ID}"');
    expect(initResources).toContain('state_set_string agent_runner.id');
    expect(initResources).toContain('state_set_string agent_runner.runner_provider "${AGENT_RUNNER_PROVIDER}"');
    expect(initResources).toContain('state_set_string agent_runner.managed "${AGENT_RUNNER_MANAGED}"');
    expect(initResources).toContain('state_set_string agent_runner.default_endpoint_id "${AGENT_RUNNER_DEFAULT_ENDPOINT_ID}"');
    expect(initResources).toContain('state_set_string agent_task_model_setting.endpoint_id "${AGENT_TASK_MODEL_SETTING_ENDPOINT_ID}"');
    expect(initResources).toContain('AGENT_TASK_MODEL_SETTING_ENDPOINT_ID=${AGENT_TASK_MODEL_SETTING_ENDPOINT_ID}');
    expect(initResources).toContain('AGENT_RUNNER_DEFAULT_ENDPOINT_ID=${AGENT_RUNNER_DEFAULT_ENDPOINT_ID}');
    expect(initResources).toContain('AGENT_RUNNER_ID=${AGENT_RUNNER_ID}');
    expect(initResources).toContain('AGENT_RUNNER_PROVIDER=${AGENT_RUNNER_PROVIDER}');
    expect(initResources).toContain('AGENT_RUNNER_KEY_PRESENT=${AGENT_RUNNER_KEY_PRESENT}');
    expect(initResources).toContain('AGENT_RUNNER_KEY_FINGERPRINT=${AGENT_RUNNER_KEY_FINGERPRINT}');
    expect(initResources).not.toContain('AGENT_RUNNER_KEY=${AGENT_RUNNER_KEY}');
    expect(initResources).not.toMatch(/^AGENT_RUNNER_KEY=\$\{AGENT_RUNNER_KEY\}$/mu);
    expect(runnerEnvResolver).toContain('await service.createAgentKey(workspaceId, projectId, runner.id)');
    expect(runnerEnvResolver).not.toContain('readSimpleEnvValue(summary, \'AGENT_RUNNER_KEY\')');
    expect(runnerEnvResolver).not.toContain('readSimpleEnvValue(summary, \'AGENT_KEY\')');
    expect(runnerEnvResolver).toContain("runner.runner_provider === 'developer'");
    expect(makefile).toContain('@env -u http_proxy -u https_proxy -u all_proxy');
    expect(initResources).not.toContain('agent_runner.key');
    expect(initResources).not.toContain('managed runner key written');
    expect(initResources).not.toContain('/agents');
    expect(initResources).not.toContain('-X POST "${PROJECT_BASE}/agent-runners"');
    expect(initResources).not.toContain('/agent-runners/${AGENT_RUNNER_ID}/keys');
    expect(initResources).not.toContain('mode:"managed"');
    expect(initResources).not.toContain('runner_runtime');
    expect(initResources).not.toContain('execution_preferences');
    expect(initResources).not.toContain('AGENT_ID=${AGENT_ID}');
  });

  it('binds external terminal smoke tasks to Developer runners while reseeding managed state for internal coverage', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );
    const matrixGate = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-matrix-real-gate.sh'),
      'utf-8',
    );
    const internalCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-common.sh'),
      'utf-8',
    );

    expect(externalSmoke).toContain('TASK_AGENT_RUNNER_ID="${TASK_AGENT_RUNNER_ID:-$(state_get agent_runner.id)}"');
    expect(externalSmoke).toContain('TASK_AGENT_RUNNER_PROVIDER="${TASK_AGENT_RUNNER_PROVIDER:-$(state_get agent_runner.runner_provider)}"');
    expect(externalSmoke).toContain('expected Developer runner diagnostic state');
    expect(externalSmoke).toContain('bound_runner_id: agentRunnerId');
    expect(internalSmoke).toContain('TASK_AGENT_RUNNER_PROVIDER="${TASK_AGENT_RUNNER_PROVIDER:-$(state_get agent_runner.runner_provider)}"');
    expect(internalSmoke).toContain('expected managed runner diagnostic state');
    for (const source of [externalSmoke, internalSmoke]) {
      expect(source).toContain('created.terminal_session_id');
      expect(source).toContain('terminal_session_id');
      expect(source).not.toContain('created.session_id');
    }
    expect(matrixGate).toContain('AGENT_RUNNER_SEED_MODE=developer_runner bash scripts/local-manual/seed-agent-task-diagnostics.sh');
    expect(matrixGate).toContain('AGENT_RUNNER_SEED_MODE=developer_runner bash scripts/local-manual/seed-agent-task-diagnostics.sh >/dev/null');
    expect(internalCommon).toContain('managed_agent_task_runner_state_is_present');
    expect(internalCommon).toContain('current_runner_provider="$(state_get agent_runner.runner_provider)"');
    expect(internalCommon).toContain('AGENT_RUNNER_SEED_MODE=managed_agent_task');
    expect(internalCommon).toContain('current_runner_provider}" == "managed"');
  });

  it('rebuilds the local-manual world without the retired stale JuiceFS preflight', async () => {
    const localManualUp = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/up.sh'),
      'utf-8',
    );
    const localManualCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/common.sh'),
      'utf-8',
    );

    expect(localManualCommon).not.toContain('run_juicefs_orphan_preflight()');
    expect(localManualCommon).toContain('local_manual_platform_ready_state()');
    expect(localManualCommon).toContain('local_manual_platform_is_ready()');
    expect(localManualCommon).not.toContain('LOCAL_MANUAL_SKIP_JUICEFS_ORPHAN_PREFLIGHT');
    expect(localManualCommon).not.toContain('scripts/juicefs-orphan-preflight.ts');
    expect(localManualCommon).toContain('runner_socket_health_state()');
    expect(localManualCommon).toContain('ensure_local_manual_runner_connected()');
    expect(localManualCommon).toContain('local_manual_runner_health_monitor_once()');
    expect(localManualCommon).toContain("schema_version: 2");
    expect(localManualCommon).toContain('shutting_down');
    expect(localManualCommon).toContain('stale');

    const captureProxyEnvLine = findRequiredTrimmedLineIndex(
      localManualUp,
      'local_manual_capture_substrate_proxy_env',
    );
    const initEnvLine = findRequiredTrimmedLineIndex(localManualUp, 'init_local_manual_env');
    const resetStateLine = findRequiredTrimmedLineIndex(localManualUp, 'reset_local_manual_state');
    const substrateBootstrapLine = findRequiredTrimmedLineIndex(
      localManualUp,
      'local_manual_run_substrate_script up',
    );
    const substrateReseedLine = findRequiredTrimmedLineIndex(
      localManualUp,
      'local_manual_run_substrate_script reseed',
    );
    const loadSubstrateEnvLine = findRequiredTrimmedLineIndex(
      localManualUp,
      'load_local_manual_substrate_env',
    );
    const captureProxyEnvBody = extractShellFunctionBody(
      localManualUp,
      'local_manual_capture_substrate_proxy_env',
    );
    const runSubstrateScriptBody = extractShellFunctionBody(
      localManualUp,
      'local_manual_run_substrate_script',
    );

    expect(captureProxyEnvLine).toBeLessThan(initEnvLine);
    expect(initEnvLine).toBeLessThan(resetStateLine);
    expect(resetStateLine).toBeLessThan(substrateBootstrapLine);
    expect(substrateBootstrapLine).toBeLessThan(substrateReseedLine);
    expect(substrateReseedLine).toBeLessThan(loadSubstrateEnvLine);
    expect(captureProxyEnvBody).toContain('LOCAL_MANUAL_SUBSTRATE_PROXY_BASE_URL_WAS_SET=1');
    expect(captureProxyEnvBody).toContain('LOCAL_MANUAL_SUBSTRATE_PROXY_ADMIN_TOKEN_WAS_SET=1');
    expect(runSubstrateScriptBody).toContain('local script_name="$1"');
    expect(runSubstrateScriptBody).toContain('export MBOS_UNIVERSAL_PROXY_BASE_URL="${LOCAL_MANUAL_SUBSTRATE_PROXY_BASE_URL_VALUE}"');
    expect(runSubstrateScriptBody).toContain('unset MBOS_UNIVERSAL_PROXY_BASE_URL');
    expect(runSubstrateScriptBody).toContain('export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${LOCAL_MANUAL_SUBSTRATE_PROXY_ADMIN_TOKEN_VALUE}"');
    expect(runSubstrateScriptBody).toContain('unset MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
    expect(runSubstrateScriptBody).toContain('SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/${script_name}.sh"');
  });

  it('resolves managed runner launch credentials from seeded runner state instead of a deprecated key file', async () => {
    const makefile = await readFile(
      path.resolve(process.cwd(), 'Makefile'),
      'utf-8',
    );

    expect(makefile).toContain('agent-task-runner-from-state:');
    expect(makefile).toContain('scripts/agent-runner-resolve-managed-runner-env.ts');
    expect(makefile).toContain('j?.agent_runner?.ws_url');
    expect(makefile).not.toContain('j?.agent_runner?.key');
    expect(makefile).not.toContain('.agent_runner.key');
    expect(makefile).toContain('WS_URL="$${AGENT_WS_URL');
    expect(makefile).toContain('AGENT_KEY_VALUE="$${AGENT_KEY');
    expect(makefile).toContain(
      'AGENT_WS_URL="$$WS_URL" \\',
    );
    expect(makefile).toContain(
      'AGENT_KEY="$$AGENT_KEY_VALUE" \\',
    );
    expect(makefile).toContain(
      'AGENT_WS_URL="$$WS_URL" \\\n\tAGENT_KEY="$$AGENT_KEY_VALUE" \\\n\t$(MAKE) agent-task-runner',
    );
  });

  it('keeps local-real hand testing aligned with the default managed runner runtime', async () => {
    const makefile = await readFile(
      path.resolve(process.cwd(), 'Makefile'),
      'utf-8',
    );
    const startApi = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/start-api.sh'),
      'utf-8',
    );

    expect(makefile).toMatch(/local-real-up:[\s\S]*\$\(MAKE\) local-manual-up[\s\S]*\$\(MAKE\) local-manual-internal-up/);
    expect(makefile).toMatch(/local-real-reset:[\s\S]*AGENT_RUNNER_SEED_MODE=managed_agent_task[\s\S]*LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0[\s\S]*\$\(MAKE\) local-manual-seed-agent-task[\s\S]*\$\(MAKE\) local-manual-internal-up/);
    expect(startApi).toContain("AGENT_EXECUTION_HTTP_BASE_URL='${AGENT_EXECUTION_HTTP_BASE_URL:-http://localhost:${PORT_API}}'");
    expect(startApi).toContain("MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT='${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}'");
  });

  it('keeps the UX gate focused on reload/re-entry hydration and same-task recovery so backend session truth survives interruptions', async () => {
    const uxSpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-agent-task-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(uxSpec).toContain('/agent-tasks/${prepared.taskId}');
    expect(uxSpec).toContain("page.getByTestId('agent-task__task-header')");
    expect(uxSpec).toContain("page.getByTestId('agent-task__task-header-mode-terminal').click()");
    expect(uxSpec).toContain("page.getByTestId('agent-tasks__task-terminal-status-strip')");
    expect(uxSpec).toContain("page.getByTestId('agent-tasks__task-terminal-workspace')");
    expect(uxSpec).toContain("page.getByTestId('agent-tasks__task-terminal-create')");
    expect(uxSpec).toContain('createTerminalSessionViaApi(');
    expect(uxSpec).toContain('expectTerminalSessionRunnerEvidenceViaApi');
    expect(uxSpec).toContain('listTerminalSessionsViaApi');
    expect(uxSpec).toContain('expectSingleTerminalSessionViaApi');
    expect(uxSpec).toContain('page.reload');
    expect(uxSpec).toContain('/agent-tasks`');
    expect(uxSpec).toContain('reload-agent-task-terminal-workspace');
    expect(uxSpec).toContain('re-enter-agent-task-terminal-workspace');
    expect(uxSpec).toContain('expectNoSecondTerminalSessionViaApi');
    expect(uxSpec).toContain('terminalSession.sessionId');
    expect(uxSpec).toContain('TERMINAL_FAILED_OR_GENERIC_ERROR_TEXT');
    expect(uxSpec).toContain('expectTerminalWorkspaceNoFailedOrGenericError');
    expect(uxSpec).toContain('expectTerminalIoThroughPage');
    expect(uxSpec).toContain('focusActiveTerminalInput');
    expect(uxSpec).toContain('resetActiveTerminalPrompt');
    expect(uxSpec).toContain('formatTerminalPrintfCommand');
    expect(uxSpec).toContain('keyboard.insertText(formatTerminalPrintfCommand(args.marker))');
    expect(uxSpec).toContain('textarea.xterm-helper-textarea');
    expect(uxSpec).not.toContain('keyboard.type(`printf');
    expect(uxSpec).not.toContain('encodeTerminalPrintfPayload');
    expect(uxSpec).toContain('cleanupTerminalSessionAfterEvidence');
    expect(uxSpec).toContain('waitForTerminalSessionFinalTruthViaApi');
    expect(uxSpec).toContain('formatTerminalSessionCloseTruthForAttachment');
    expect(uxSpec).toContain('readRemainingTerminalSessionIds');
    expect(uxSpec).toContain('close_truth_error=');
    expect(uxSpec).toContain('list_wait_error=');
    expect(uxSpec).toContain('activeTerminalSessionId = terminalSession.sessionId');
    expect(uxSpec).toContain('if (primaryFailure) throw primaryFailure;');
    expect(uxSpec).toContain('if (cleanupFailure) throw cleanupFailure;');
    const activeSessionBlockStart = uxSpec.indexOf('const terminalSession = await createTerminalSessionViaApi({');
    const activeSessionBlockEnd = uxSpec.indexOf('await expectNoSecondTerminalSessionViaApi({', activeSessionBlockStart);
    expect(activeSessionBlockStart).toBeGreaterThanOrEqual(0);
    expect(activeSessionBlockEnd).toBeGreaterThan(activeSessionBlockStart);
    const activeSessionBlock = uxSpec.slice(activeSessionBlockStart, activeSessionBlockEnd);
    const blockerVisibleIndex = activeSessionBlock.indexOf(
      "await expect(conversationBlocker).toBeVisible({ timeout: 30_000 });",
    );
    const blockerSessionCountIndex = activeSessionBlock.indexOf(
      "await expect(conversationBlocker).toContainText('1 terminal session');",
    );
    const blockerActionVisibleIndex = activeSessionBlock.indexOf(
      'await expect(openTerminalWorkspaceAction).toBeVisible();',
    );
    const blockerActionLabelIndex = activeSessionBlock.indexOf(
      "await expect(openTerminalWorkspaceAction).toContainText('Open Terminal Workspace');",
    );
    const blockerActionClickIndex = activeSessionBlock.indexOf('await openTerminalWorkspaceAction.click();');
    const terminalWorkspaceVisibleIndex = activeSessionBlock.indexOf(
      "page.getByTestId('agent-tasks__task-terminal-workspace')).toBeVisible",
    );
    const blockerGoneIndex = activeSessionBlock.indexOf(
      "page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0)",
    );

    for (const index of [
      blockerVisibleIndex,
      blockerSessionCountIndex,
      blockerActionVisibleIndex,
      blockerActionLabelIndex,
      blockerActionClickIndex,
      terminalWorkspaceVisibleIndex,
      blockerGoneIndex,
    ]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(blockerVisibleIndex).toBeLessThan(blockerActionClickIndex);
    expect(blockerSessionCountIndex).toBeLessThan(blockerActionClickIndex);
    expect(blockerActionVisibleIndex).toBeLessThan(blockerActionClickIndex);
    expect(blockerActionLabelIndex).toBeLessThan(blockerActionClickIndex);
    expect(blockerActionClickIndex).toBeLessThan(terminalWorkspaceVisibleIndex);
    expect(terminalWorkspaceVisibleIndex).toBeLessThan(blockerGoneIndex);
    expect(activeSessionBlock.slice(0, blockerActionClickIndex)).not.toContain(
      "page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0)",
    );

    const reloadBlockStart = uxSpec.indexOf("await page.reload({ waitUntil: 'domcontentloaded' });");
    const reloadTraceIndex = uxSpec.indexOf("stepId: 'reload-agent-task-terminal-workspace'", reloadBlockStart);
    const reenterBlockStart = uxSpec.indexOf('await page.goto(taskListRoute);');
    const reenterTraceIndex = uxSpec.indexOf("stepId: 're-enter-agent-task-terminal-workspace'", reenterBlockStart);
    expect(reloadBlockStart).toBeGreaterThanOrEqual(0);
    expect(reloadTraceIndex).toBeGreaterThan(reloadBlockStart);
    expect(reenterBlockStart).toBeGreaterThan(reloadTraceIndex);
    expect(reenterTraceIndex).toBeGreaterThan(reenterBlockStart);
    const reloadBlock = uxSpec.slice(reloadBlockStart, reloadTraceIndex);
    const reenterBlock = uxSpec.slice(reenterBlockStart, reenterTraceIndex);
    expect(reloadBlock).toContain('expectTerminalWorkspaceNoFailedOrGenericError(page)');
    expect(reenterBlock).toContain('expectTerminalWorkspaceNoFailedOrGenericError(page)');
    expect(reenterBlock).toContain('expectTerminalIoThroughPage({');
    expect(reenterBlock).toContain('AGENTSMITH_REENTER_IO_');
    expect(reloadBlock.indexOf('expectTerminalWorkspaceNoFailedOrGenericError(page)')).toBeLessThan(
      reloadBlock.indexOf('expectNoSecondTerminalSessionViaApi({'),
    );
    expect(reenterBlock.indexOf('expectTerminalWorkspaceNoFailedOrGenericError(page)')).toBeLessThan(
      reenterBlock.indexOf('expectNoSecondTerminalSessionViaApi({'),
    );
    expect(reenterBlock.indexOf('expectNoSecondTerminalSessionViaApi({')).toBeLessThan(
      reenterBlock.indexOf('expectTerminalIoThroughPage({'),
    );

    const traceFinishIndex = uxSpec.indexOf('multiSessionTrace.finish({ outcome })');
    const cleanupIndex = uxSpec.indexOf('cleanupTerminalSessionAfterEvidence({');
    const primaryThrowIndex = uxSpec.indexOf('if (primaryFailure) throw primaryFailure;');
    const cleanupThrowIndex = uxSpec.indexOf('if (cleanupFailure) throw cleanupFailure;');
    expect(traceFinishIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupIndex).toBeGreaterThan(traceFinishIndex);
    expect(primaryThrowIndex).toBeGreaterThan(cleanupIndex);
    expect(cleanupThrowIndex).toBeGreaterThan(primaryThrowIndex);
    expect(uxSpec).not.toContain('/notebook');
    expect(uxSpec).not.toContain('notebook__');
    expect(uxSpec).not.toContain("loadStoryDefinitionSync('notebook-terminal");
  });

  it('keeps Agent Task terminal UX trace captures bound to canonical story step actions and targets', async () => {
    const uxSpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-agent-task-terminal-ux.spec.ts'),
      'utf-8',
    );
    const traceBindings = [
      {
        traceName: 'multiSessionTrace',
        storyId: 'agent-task-terminal-workspace-multi-session',
        expectedStepIds: [
          'return-to-agent-task',
          'open-terminal-workspace',
        ],
      },
      {
        traceName: 'truthRetryTrace',
        storyId: 'agent-task-terminal-truth-unavailable-retry',
        expectedStepIds: [
          'return-to-task-while-terminal-truth-is-unavailable',
          'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing',
          'retry-terminal-truth-check-from-blocked-task',
          'unlock-task-after-terminal-truth-recovers',
        ],
      },
      {
        traceName: 'reentryTrace',
        storyId: 'agent-task-terminal-reentry-recovery',
        expectedStepIds: [
          'return-to-interrupted-agent-task',
          'reload-agent-task-terminal-workspace',
          're-enter-agent-task-terminal-workspace',
        ],
      },
    ] as const;

    for (const traceBinding of traceBindings) {
      const story = loadStoryDefinitionSync(traceBinding.storyId);
      const binding = buildTraceStoryBinding(story);
      const capturedEvents = extractTerminalUxTraceCaptureEvents(uxSpec, traceBinding.traceName);

      expect(capturedEvents.map((event) => event.stepId)).toEqual(traceBinding.expectedStepIds);
      for (const event of capturedEvents) {
        const boundEvent = bindTraceEventToStory(binding, event);
        expect(boundEvent.action).toBe(event.action);
        expect(boundEvent.target).toBe(event.target);
      }
    }
  });

  it('keeps local-manual status and verification aligned with current runner socket health instead of ready-file-only state', async () => {
    const status = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/status.sh'),
      'utf-8',
    );
    const appStatus = await readFile(
      path.resolve(process.cwd(), 'scripts/app/status.sh'),
      'utf-8',
    );
    const internalStatus = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-status.sh'),
      'utf-8',
    );
    const verifyAgentTaskDiagnostics = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/verify-agent-task-diagnostics.sh'),
      'utf-8',
    );
    const realSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/agent-task-terminal-internal-real-smoke.sh'),
      'utf-8',
    );
    const internalCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-common.sh'),
      'utf-8',
    );
    const internalUp = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-up.sh'),
      'utf-8',
    );

    expect(status).toContain('runner_socket_health_state');
    expect(appStatus).toContain('runner_socket_health_state');
    expect(appStatus).not.toContain('RUNNER_READY_FILE');
    expect(internalStatus).toContain('Runner socket:');
    expect(internalStatus).toContain('runner_socket_health_state');
    expect(verifyAgentTaskDiagnostics).toContain('AGENT_RUNNER_ID="$(state_get agent_runner.id)"');
    expect(verifyAgentTaskDiagnostics).toContain('WS_URL="$(state_get agent_runner.ws_url)"');
    expect(verifyAgentTaskDiagnostics).toContain('runner_socket_is_connected');
    expect(realSmoke).toContain('runner_socket_is_connected');
    expect(realSmoke).toContain('ensure_local_manual_runner_connected');
    expect(realSmoke).toContain('task_runner_offline');
    expect(realSmoke).not.toContain('agent_id:');
    expect(realSmoke).not.toContain('TASK_AGENT_ID');
    expect(internalSmoke).toContain('INTERNAL_RUNTIME_CLEANUP_MARKER');
    expect(internalSmoke).toContain('restartInternalRuntime()');
    expect(internalSmoke).toContain('task_terminal_internal_runtime_unavailable');
    expect(internalSmoke).toContain('task_runner_offline');
    expect(internalSmoke).not.toContain('agent_id:');
    expect(internalSmoke).not.toContain('TASK_AGENT_ID');
    expect(internalCommon).toContain('agent-task diagnostic state missing after internal API restart; preparing managed agent-task diagnostic state');
    expect(internalCommon).toContain('ensure_agent_task_diagnostics_ready');
    expect(internalCommon).toContain('restore_local_manual_external_mode()');
    expect(internalUp).toContain('trap');
    expect(internalUp).toContain('bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart');
  });

  it('keeps local-manual web on a lane-private next output while explicitly protecting the root contract', async () => {
    const startWeb = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/start-web.sh'),
      'utf-8',
    );

    expect(startWeb).toContain("NEXT_DIST_DIR='${LOCAL_MANUAL_NEXT_DIST_DIR}'");
    expect(startWeb).toContain("NEXT_GENERATED_ROOT_MANAGED='1'");
    expect(startWeb).toContain("NEXT_GENERATED_ROOT_STATE_DIR='${LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR}'");
  });

  it('keeps the Agent Task terminal story catalog gated around canonical workspace and recovery journeys', async () => {
    const { stories, generatedSpecs } = await loadCanonicalStoryCatalog();
    const agentTaskTerminalStories = stories.filter((story) => story.storyId.startsWith('agent-task-terminal-'));
    const agentTaskTerminalSpecs = generatedSpecs.filter((story) => story.storyId.startsWith('agent-task-terminal-'));

    expect(agentTaskTerminalStories.map((story) => story.storyId)).toEqual([
      'agent-task-terminal-reentry-recovery',
      'agent-task-terminal-truth-unavailable-retry',
      'agent-task-terminal-workspace-multi-session',
    ]);
    expect(agentTaskTerminalSpecs.map((story) => story.storyId)).toEqual(
      agentTaskTerminalStories.map((story) => story.storyId),
    );
    expect(agentTaskTerminalStories.every((story) => story.family === 'agent-task-terminal-workspace')).toBe(true);
    expect(agentTaskTerminalStories.every((story) => story.gatePolicy.requiredEvidence.includes('trace'))).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasBoundTaskSummary(value) {
  return ['bound_task_id', 'bound_task_title', 'bound_task_status'].some((key) =>
    hasOwn(value, key) && value[key] !== undefined
  );
}

export function isReusableTaskWorkspaceFileLibrary(value) {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && value.status === 'ready'
    && value.task_home_binding_status === 'unbound'
    && value.bound_task_visible === false
    && !hasBoundTaskSummary(value);
}

export function selectReusableTaskWorkspaceFileLibraryId(payload) {
  if (!isRecord(payload)) {
    return null;
  }
  if (hasOwn(payload, 'items') && !Array.isArray(payload.items)) {
    return null;
  }
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  const library = items.find(isReusableTaskWorkspaceFileLibrary);
  return typeof library?.id === 'string' ? library.id : null;
}

function readStdin() {
  return readFileSync(0, 'utf8');
}

function runCli() {
  try {
    const payload = JSON.parse(readStdin());
    const selected = selectReusableTaskWorkspaceFileLibraryId(payload);
    if (!selected) {
      process.exitCode = 2;
      return;
    }
    process.stdout.write(selected);
  } catch {
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli();
}

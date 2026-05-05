export type RunnerFilterStats = {
  stderr_superpowers_skill_missing: number;
  model_metadata_warning: number;
  stderr_model_refresh_timeout: number;
  stderr_rollout_record_missing_thread: number;
  delta_metadata_warning_event: number;
  delta_empty_error_shell: number;
};

const STDERR_FILTER_PATTERNS: RegExp[] = [
  /ERROR codex_core::skills::loader: failed to stat skills entry .*\/\.agents\/skills\/superpowers .*$/gim,
  /Model metadata for `[^`]+` not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\./g,
  /^.*ERROR codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit$/gim,
  /^.*ERROR codex_core::session: failed to record rollout items: thread [0-9a-f-]+ not found$/gim,
];

const DELTA_FILTER_PATTERNS: RegExp[] = [
  /\{"type":"item\.completed","item":\{"id":"[^"]+","type":"error","message":"Model metadata for `[^`]+` not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\."\}\}/g,
  /\{"type":"item\.completed","item":\{"id":"[^"]+","type":"error","message":""\}\}/g,
  ...STDERR_FILTER_PATTERNS,
];

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let count = 0;
  while (re.exec(text)) count += 1;
  return count;
}

export function sanitizeAgentDeltaChunk(
  raw: string,
  getStats?: () => RunnerFilterStats,
): string {
  let text = raw;
  if (getStats) {
    const stats = getStats();
    stats.delta_metadata_warning_event += countMatches(DELTA_FILTER_PATTERNS[0]!, text);
    stats.delta_empty_error_shell += countMatches(DELTA_FILTER_PATTERNS[1]!, text);
    stats.stderr_superpowers_skill_missing += countMatches(STDERR_FILTER_PATTERNS[0]!, text);
    stats.model_metadata_warning += countMatches(STDERR_FILTER_PATTERNS[1]!, text);
    stats.stderr_model_refresh_timeout += countMatches(STDERR_FILTER_PATTERNS[2]!, text);
    stats.stderr_rollout_record_missing_thread += countMatches(STDERR_FILTER_PATTERNS[3]!, text);
  }
  for (const pattern of DELTA_FILTER_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text;
}

export function sanitizeStderrChunk(
  raw: string,
  getStats?: () => RunnerFilterStats,
): string {
  let text = sanitizeAgentDeltaChunk(raw, getStats);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

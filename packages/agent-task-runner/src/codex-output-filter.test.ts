import { describe, expect, it } from 'vitest';
import { sanitizeAgentDeltaChunk, sanitizeStderrChunk, type RunnerFilterStats } from './codex-output-filter.js';

function makeStats(): RunnerFilterStats {
  return {
    stderr_superpowers_skill_missing: 0,
    model_metadata_warning: 0,
    stderr_model_refresh_timeout: 0,
    stderr_rollout_record_missing_thread: 0,
    delta_metadata_warning_event: 0,
    delta_empty_error_shell: 0,
  };
}

describe('codex-output-filter', () => {
  it('removes model metadata warning event shell from delta output and counts hit', () => {
    const stats = makeStats();
    const input = '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `placeholder-model` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}';
    const out = sanitizeAgentDeltaChunk(input, () => stats);
    expect(out).toBe('');
    expect(stats.delta_metadata_warning_event).toBe(1);
    expect(stats.model_metadata_warning).toBe(1);
  });

  it('removes harmless superpowers symlink stderr and collapses blank lines', () => {
    const stats = makeStats();
    const input = [
      '2026-02-21T17:17:28Z ERROR codex_core::skills::loader: failed to stat skills entry /home/percy/.agents/skills/superpowers (symlink): No such file or directory (os error 2)',
      '',
      '',
      'next line',
    ].join('\n');
    const out = sanitizeStderrChunk(input, () => stats);
    expect(out).toContain('next line');
    expect(out).not.toContain('failed to stat skills entry');
    expect(stats.stderr_superpowers_skill_missing).toBe(1);
  });

  it('removes expected model refresh timeout stderr noise', () => {
    const stats = makeStats();
    const input = [
      '2026-03-18T13:32:41.530743Z ERROR codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit',
      'next line',
    ].join('\n');
    const out = sanitizeStderrChunk(input, () => stats);
    expect(out).toBe('next line');
    expect(stats.stderr_model_refresh_timeout).toBe(1);
  });

  it('removes expected rollout missing-thread stderr noise and counts hit', () => {
    const stats = makeStats();
    const input = [
      '2026-04-29T11:12:13.000000Z ERROR codex_core::session: failed to record rollout items: thread 0196984a-cdbe-7fff-8abc-0123456789ab not found',
      'next line',
    ].join('\n');
    const out = sanitizeStderrChunk(input, () => stats);
    expect(out).toBe('next line');
    expect(stats.stderr_rollout_record_missing_thread).toBe(1);
  });
});

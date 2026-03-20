import { describe, expect, it } from 'vitest';
import { filterNewArtifactsForRun, type ScannedArtifact } from './artifact-scan.js';

function makeArtifact(
  path: string,
  size = 100,
  mtime = 1,
): ScannedArtifact {
  return {
    filename: path.split('/').pop() ?? 'artifact.txt',
    task_relative_path: path,
    artifact_type: 'text',
    file_size: size,
    mtime_ms: mtime,
  };
}

describe('filterNewArtifactsForRun', () => {
  it('deduplicates repeated artifacts within the same run key', () => {
    const seen = new Map<string, Set<string>>();
    const artifact = makeArtifact('.artifacts/result.md');

    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([artifact]);
    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([]);
  });

  it('does not suppress the same artifact path across different run keys', () => {
    const seen = new Map<string, Set<string>>();
    const artifact = makeArtifact('.artifacts/result.md');

    expect(filterNewArtifactsForRun(seen, 'run-a', [artifact])).toEqual([artifact]);
    expect(filterNewArtifactsForRun(seen, 'run-b', [artifact])).toEqual([artifact]);
  });
});

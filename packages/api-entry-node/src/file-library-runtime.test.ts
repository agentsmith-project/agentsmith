import { describe, expect, it } from 'vitest';

import { getFileLibraryRuntimeReadiness } from './file-library-runtime.js';

describe('file-library-runtime readiness', () => {
  it('reports missing executables and env explicitly', async () => {
    const readiness = await getFileLibraryRuntimeReadiness({
      juicefsBin: 'missing-juicefs-cli',
      mcBin: 'missing-mc-cli',
      env: {},
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.juicefs).toBe('missing');
    expect(readiness.checks.mc).toBe('missing');
    expect(readiness.checks.database_url).toBe('missing');
    expect(readiness.errors).toContain('file_library_juicefs_cli_missing');
    expect(readiness.errors).toContain('file_library_mc_cli_missing');
    expect(readiness.errors).toContain('file_library_env_missing_database_url');
    expect(readiness.errors).toContain('file_library_env_missing_minio_endpoint');
    expect(readiness.errors).toContain('file_library_env_missing_minio_access_key');
    expect(readiness.errors).toContain('file_library_env_missing_minio_secret_key');
  });
});

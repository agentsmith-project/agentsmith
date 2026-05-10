import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('file library backend-real smoke project storage readiness', () => {
  it('waits on typed project storage pending before creating the smoke library', () => {
    const script = readFileSync('scripts/file-library-real-smoke.sh', 'utf8');

    expect(script).toContain('create_library_when_project_storage_ready()');
    expect(script).toContain('response_error_code()');
    expect(script).toContain('"${error_code}" == "PROJECT_STORAGE_PENDING"');
    expect(script).toContain('FILE_LIBRARY_PROJECT_STORAGE_READY_ATTEMPTS');
    expect(script).toContain('timed out waiting for project storage readiness before file library create');
    expect(script).toContain('create_library_when_project_storage_ready "{\\"name\\":\\"${local_name}\\",\\"description\\":\\"Release smoke library\\"}"');
    expect(script).toContain('content_type_media_type()');
    expect(script).toContain('META_MEDIA_TYPE="$(content_type_media_type "${META_CONTENT_TYPE}")"');
    expect(script).toContain('[[ "${META_MEDIA_TYPE}" != "text/plain" ]]');
    expect(script).toContain('delete_empty_library_when_terminal()');
    expect(script).toContain('wait_file_library_delete_operation_terminal()');
    expect(script).toContain('"${status}" == "202"');
    expect(script).toContain('/file-library-operations/${operation_id}');
    expect(script).toContain('operation_status}" != "pending"');
    expect(script).toContain('timed out reconciling empty file library delete');
  });
});

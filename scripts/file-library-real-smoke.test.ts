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
    expect(script).toContain('project_has_ready_managed_runner()');
    expect(script).toContain('/agent-runners")');
    expect(script).toContain('content_type_media_type()');
    expect(script).toContain('META_MEDIA_TYPE="$(content_type_media_type "${META_CONTENT_TYPE}")"');
    expect(script).toContain('[[ "${META_MEDIA_TYPE}" != "text/plain" ]]');
    expect(script).toContain('/file-libraries/${LIBRARY_ID}/save-points');
    expect(script).toContain('created save point missing from save point list');
    expect(script).toContain('failed to delete guide after save point');
    expect(script).toContain('post-save-point mutation delete');
    expect(script).toContain('Smoke save point after mutation');
    expect(script).toContain('api_json_with_idempotency()');
    expect(script).toContain('Idempotency-Key: ${idempotency_key}');
    expect(script).toContain('/file-libraries/${LIBRARY_ID}/restore"');
    expect(script).toContain('\\"discard_unsaved_changes_confirmed\\":true');
    expect(script).toContain('wait_restore_operation_terminal()');
    expect(script).toContain('direct restore changed save point count; possible restore-triggered save point');
    expect(script).toContain('direct restore created an internal-looking save point');
    expect(script).toContain('restored file content mismatch');
    expect(script).toContain('/task-file-templates');
    expect(script).toContain('/task-file-templates/${TASK_FILE_TEMPLATE_ID}/publish');
    expect(script).toContain('\\"workspace_mode\\":\\"use_template\\"');
    expect(script).toContain('task file template clone did not create an independent file library');
    expect(script).toContain('cloned task file library is missing template source file');
    expect(script).toContain('delete_empty_library_when_terminal()');
    expect(script).toContain('wait_file_library_delete_operation_terminal()');
    expect(script).toContain('assert_no_raw_afscp_ids()');
    expect(script).toContain('leaked raw AFSCP resource ids');
    expect(script).toContain('[0-9]{13}-[0-9a-f]{8}');
    expect(script).toContain('"${status}" == "202"');
    expect(script).toContain('/file-library-operations/${operation_id}');
    expect(script).toContain('operation_status}" != "pending"');
    expect(script).toContain('timed out reconciling empty file library delete');
  });
});

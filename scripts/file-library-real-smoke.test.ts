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
    const savePointPostCalls = Array.from(
      script.matchAll(/status="\$\(api_json(?:_with_idempotency)? POST "([^"]*\/save-points)" "([^"]+)" '[^']+'\)"/g),
    );
    expect(savePointPostCalls).toHaveLength(2);
    expect(savePointPostCalls.map((match) => match[2])).toEqual([
      '${SAVE_POINT_IDEMPOTENCY_KEY}',
      '${MUTATION_SAVE_POINT_IDEMPOTENCY_KEY}',
    ]);
    expect(new Set(savePointPostCalls.map((match) => match[2])).size).toBe(savePointPostCalls.length);
    expect(script).toContain(
      'SAVE_POINT_IDEMPOTENCY_KEY="file-library-smoke-save-point-${WORKSPACE_ID}-${PROJECT_ID}-${LIBRARY_ID}-before-template-publish"',
    );
    expect(script).toContain(
      'MUTATION_SAVE_POINT_IDEMPOTENCY_KEY="file-library-smoke-save-point-${WORKSPACE_ID}-${PROJECT_ID}-${LIBRARY_ID}-after-mutation"',
    );
    expect(script).not.toMatch(/api_json POST "[^"]*\/save-points"/);
    expect(script).toContain('created save point missing from save point list');
    expect(script).toContain('failed to delete guide after save point');
    expect(script).toContain('post-save-point mutation delete');
    expect(script).toContain('Smoke save point after mutation');
    expect(script).toContain('api_json_with_idempotency()');
    expect(script).toContain('Idempotency-Key: ${idempotency_key}');
    expect(script).toContain('/file-libraries/${LIBRARY_ID}/restore"');
    expect(script).toContain('"{\\"save_point_id\\":\\"${SAVE_POINT_ID}\\"}"');
    expect(script).not.toContain(`discard_${'unsaved'}_changes_confirmed`);
    expect(script).toContain('RESTORE_OPERATION_SOURCE_SAVE_POINT_ID');
    expect(script).toContain('direct restore operation did not reference the requested save point');
    expect(script).toContain('wait_restore_operation_terminal()');
    expect(script).not.toContain('is no longer active');
    expect(script).not.toContain('disappeared from active projection before terminal succeeded');
    expect(script).toContain('/file-library-operations/${operation_id}');
    expect(script).toContain('restore_operation_lookup_succeeded');
    expect(script).not.toMatch(/if \[\[ -z "\$\{operation_status\}" \]\]; then[\s\S]{0,240}return 0/);
    expect(script).toContain('is_restore_operation_succeeded_state()');
    expect(script).toContain('RESTORE_TERMINAL_SEEN_IN_ACTIVE_PROJECTION="true"');
    expect(script).toContain('write_timing_evidence()');
    expect(script).toContain('FILE_LIBRARY_REAL_SMOKE_TIMING_EVIDENCE_PATH');
    expect(script).toContain('save_point_admission_latency_ms');
    expect(script).toContain('restore_admission_latency_ms');
    expect(script).toContain('restore_active_projection_first_seen_lag_ms');
    expect(script).toContain('restore_terminal_projection_lag_ms');
    expect(script).toContain('wait_save_point_id_by_message()');
    expect(script).toContain('SAVE_POINT_OPERATION_ID="$(cat "${BODY_FILE}" | json_field "j.id")"');
    expect(script).toContain('MUTATION_SAVE_POINT_OPERATION_ID="$(cat "${BODY_FILE}" | json_field "j.id")"');
    expect(script).toContain('SAVE_POINT_ID="$(wait_save_point_id_by_message "Smoke save point before template publish" "file library save point list")"');
    expect(script).toContain('MUTATION_SAVE_POINT_ID="$(wait_save_point_id_by_message "Smoke save point after mutation" "file library mutation save point list")"');
    expect(script).toMatch(/if \[\[ "\$\{status\}" != "202" \]\]; then[\s\S]{0,180}failed to create save point/);
    expect(script).toMatch(/if \[\[ "\$\{status\}" != "202" \]\]; then[\s\S]{0,180}failed to create mutation save point/);
    expect(script).not.toContain('SAVE_POINT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"');
    expect(script).not.toContain('MUTATION_SAVE_POINT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"');
    expect(script).toContain('schema_version: 2');
    expect(script).toContain('agentsmith_admission');
    expect(script).toContain('active_projection_first_seen');
    expect(script).toContain('terminal_projection');
    expect(script).toContain("source: 'agentsmith_file_library_operation_lookup'");
    expect(script).toContain('afscp_worker_hop');
    expect(script).toContain('afscp_operation');
    expect(script).toContain("source: 'not_exposed_by_agentsmith_product_api'");
    expect(script).toContain("availability: 'unavailable'");
    expect(script).toContain("source: cloneEvidencePresent ? 'operator_safe_clone_evidence_from_restore_projection' : 'not_exposed_by_agentsmith_product_api'");
    expect(script).toContain('clone_evidence');
    expect(script).toContain('duration_ms');
    expect(script).toContain('direct restore changed save point count; possible restore-triggered save point');
    expect(script).toContain('direct restore created an internal-looking save point');
    expect(script).toContain('restored file content mismatch');
    expect(script).toContain('/task-file-templates');
    expect(script).toContain('TASK_FILE_TEMPLATE_IDEMPOTENCY_KEY="file-library-smoke-task-file-template-${WORKSPACE_ID}-${PROJECT_ID}-${LIBRARY_ID}"');
    expect(script).toContain('api_json_with_idempotency POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/task-file-templates" "${TASK_FILE_TEMPLATE_IDEMPOTENCY_KEY}"');
    expect(script).toContain('TASK_FILE_TEMPLATE_LIST_COUNT_BEFORE_REPLAY');
    expect(script).toContain('TASK_FILE_TEMPLATE_REPLAY_ID="$(cat "${BODY_FILE}" | json_field "j.id")"');
    expect(script).toContain('task file template idempotency replay returned a different template id');
    expect(script).toContain('task file template idempotency replay changed template list count');
    expect(script).toContain('/task-file-templates/${TASK_FILE_TEMPLATE_ID}/publish');
    expect(script).toContain('\\"workspace_mode\\":\\"use_template\\"');
    expect(script).toContain('task file template clone did not create an independent file library');
    expect(script).toContain('cloned task file library is missing template source file');
    expect(script).toContain('cloned task file library changed after source library mutation');
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

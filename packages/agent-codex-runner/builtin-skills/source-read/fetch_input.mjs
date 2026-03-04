#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env_${name}`);
  return v;
}

async function main() {
  const apiBase = reqEnv('MBOS_NOTEBOOK_API_BASE').replace(/\/+$/, '');
  const workspaceId = reqEnv('MBOS_NOTEBOOK_WORKSPACE_ID');
  const projectId = reqEnv('MBOS_NOTEBOOK_PROJECT_ID');
  const token = reqEnv('MBOS_NOTEBOOK_USER_BEARER_TOKEN');
  const manifestPath = process.env.MBOS_NOTEBOOK_TASK_INPUTS_MANIFEST || './.mbos/task-inputs.json';
  const cmd = process.argv[2] || 'list';
  const inputIdArg = process.argv[3];

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inputs = Array.isArray(manifest.task_inputs) ? manifest.task_inputs : [];

  if (cmd === 'list') {
    process.stdout.write(JSON.stringify({ count: inputs.length, items: inputs }, null, 2) + '\n');
    return;
  }

  if (cmd === 'fetch') {
    if (!inputIdArg) throw new Error('input_id_required');
    const item = inputs.find((x) =>
      x && (
        x.source_id === inputIdArg
        || (x.library_id && x.key && `${x.library_id}:${x.key}` === inputIdArg)
        || (x.task_id && x.artifact_id && `${x.task_id}:${x.artifact_id}` === inputIdArg)
        || (x.kind === 'artifact' && x.artifact_id === inputIdArg)
        || (x.imported_library_id && x.imported_key && `${x.imported_library_id}:${x.imported_key}` === inputIdArg)
      ),
    );
    if (!item) throw new Error('source_not_in_task_inputs');
    let res;
    if (item.kind === 'library_object' && item.library_id && item.key) {
      res = await fetch(
        `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/source-libraries/${encodeURIComponent(item.library_id)}/objects/download?key=${encodeURIComponent(item.key)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } else if (item.kind === 'url' && item.imported_library_id && item.imported_key) {
      res = await fetch(
        `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/source-libraries/${encodeURIComponent(item.imported_library_id)}/objects/download?key=${encodeURIComponent(item.imported_key)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } else if (item.kind === 'artifact' && item.task_id && item.artifact_id) {
      res = await fetch(
        `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(item.task_id)}/artifacts/${encodeURIComponent(item.artifact_id)}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } else if (item.kind === 'artifact') {
      throw new Error('artifact_input_missing_identifiers');
    } else if (item.kind === 'url') {
      throw new Error('url_input_has_no_imported_object');
    } else {
      const sourceId = item.source_id || inputIdArg;
      res = await fetch(
        `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`source_download_failed_${res.status}${text ? `:${text.slice(0, 200)}` : ''}`);
    }
    const ab = await res.arrayBuffer();
    await mkdir('./inputs', { recursive: true });
    const fallbackName =
      item.source_id
      || (item.key ? String(item.key).split('/').pop() : null)
      || (item.task_relative_path ? String(item.task_relative_path).split('/').pop() : null)
      || (item.imported_key ? String(item.imported_key).split('/').pop() : null)
      || `${inputIdArg}.bin`;
    const filename = (typeof item.filename === 'string' && item.filename.trim()) ? item.filename.trim() : fallbackName;
    const outPath = join('./inputs', basename(filename));
    await writeFile(outPath, Buffer.from(ab));
    process.stdout.write(JSON.stringify({ input_id: inputIdArg, path: outPath, bytes: ab.byteLength }, null, 2) + '\n');
    return;
  }

  throw new Error('unsupported_command');
}

main().catch((err) => {
  process.stderr.write(`${String(err instanceof Error ? err.message : err)}\n`);
  process.exit(1);
});

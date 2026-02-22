#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`[bench-archive] ${message}`);
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectKind(srcDir) {
  if (fs.existsSync(path.join(srcDir, 'summary.jsonl')) && fs.existsSync(path.join(srcDir, 'summary.csv'))) {
    const sample = fs.readFileSync(path.join(srcDir, 'summary.jsonl'), 'utf8').split('\n').find(Boolean) ?? '';
    if (sample.includes('"traces_query_bench"')) return 'traces-query-sweep';
    return 'load-matrix-or-baseline';
  }
  return 'unknown';
}

const srcDir = process.env.SOURCE_DIR;
if (!srcDir) fail('SOURCE_DIR is required');
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) fail(`SOURCE_DIR not found: ${srcDir}`);

const rootDir = process.cwd();
const outRoot = process.env.OUT_ROOT || path.join(rootDir, 'artifacts', 'benchmarks');
const label = (process.env.LABEL || path.basename(srcDir)).replace(/[^a-zA-Z0-9._-]+/g, '-');
const kind = process.env.KIND || detectKind(srcDir);
const commitSha = process.env.COMMIT_SHA || process.env.GIT_COMMIT || 'unknown';
const ts = new Date().toISOString().replace(/[:]/g, '-');
const targetDir = path.join(outRoot, `${ts}__${kind}__${label}`);

ensureDir(targetDir);

const copied = [];
for (const file of ['summary.csv', 'summary.jsonl', 'stdout.log', 'result.json']) {
  if (copyIfExists(path.join(srcDir, file), path.join(targetDir, file))) copied.push(file);
}

for (const file of fs.readdirSync(srcDir)) {
  const full = path.join(srcDir, file);
  if (fs.statSync(full).isDirectory()) {
    const nestedTarget = path.join(targetDir, file);
    ensureDir(nestedTarget);
    for (const nested of ['stdout.log', 'result.json', 'metrics.json']) {
      if (copyIfExists(path.join(full, nested), path.join(nestedTarget, nested))) {
        copied.push(`${file}/${nested}`);
      }
    }
  }
}

const metadata = {
  archived_at: new Date().toISOString(),
  source_dir: srcDir,
  archive_dir: targetDir,
  label,
  kind,
  git_commit: commitSha,
  env: {
    requests: process.env.REQUESTS ?? null,
    concurrency: process.env.CONCURRENCY ?? null,
    warmup: process.env.WARMUP ?? null,
    matrix: process.env.MATRIX ?? null,
    page_sizes: process.env.PAGE_SIZES ?? null,
    page_size: process.env.PAGE_SIZE ?? null,
    prepare_task: process.env.PREPARE_TASK ?? null,
    turns: process.env.TURNS ?? null,
    mongo_url_present: Boolean(process.env.MONGO_URL),
    mongo_db_name: process.env.MONGO_DB_NAME ?? null,
    mode_label: process.env.MODE_LABEL ?? null,
  },
  files: copied,
  quick_summary: readJsonIfExists(path.join(srcDir, 'result.json')),
};

fs.writeFileSync(path.join(targetDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(JSON.stringify({
  ok: true,
  source_dir: srcDir,
  archive_dir: targetDir,
  kind,
  label,
  copied_files: copied.length,
}, null, 2));


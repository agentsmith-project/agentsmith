#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pctDelta(base, next) {
  if (typeof base !== 'number' || typeof next !== 'number' || !Number.isFinite(base) || !Number.isFinite(next)) {
    return null;
  }
  if (base === 0) return null;
  return Number((((next - base) / base) * 100).toFixed(2));
}

function keyFor(row) {
  const summary = row.summary ?? row;
  return `${summary.expected}x${summary.concurrency}`;
}

function summarizeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const summary = row.summary ?? row;
    map.set(keyFor(row), {
      key: keyFor(row),
      requests: summary.expected,
      concurrency: summary.concurrency,
      success_rate: summary.success_rate,
      p95_ms: summary.latency_ms?.p95 ?? null,
      p99_ms: summary.latency_ms?.p99 ?? null,
      avg_ms: summary.latency_ms?.avg ?? null,
      max_ms: summary.latency_ms?.max ?? null,
      failed: summary.failed ?? null,
      metrics: row.metrics ?? null,
    });
  }
  return map;
}

const dirA = process.env.BASELINE_A_DIR;
const dirB = process.env.BASELINE_B_DIR;
const labelA = process.env.BASELINE_A_LABEL || 'A';
const labelB = process.env.BASELINE_B_LABEL || 'B';

if (!dirA || !dirB) {
  console.error('[compare] BASELINE_A_DIR and BASELINE_B_DIR are required');
  process.exit(1);
}

const jsonlA = path.join(dirA, 'summary.jsonl');
const jsonlB = path.join(dirB, 'summary.jsonl');
if (!fs.existsSync(jsonlA) || !fs.existsSync(jsonlB)) {
  console.error(`[compare] summary.jsonl missing in one of the dirs:\n- ${jsonlA}\n- ${jsonlB}`);
  process.exit(1);
}

const mapA = summarizeRows(readJsonl(jsonlA));
const mapB = summarizeRows(readJsonl(jsonlB));
const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((x, y) => {
  const [rx, cx] = x.split('x').map(Number);
  const [ry, cy] = y.split('x').map(Number);
  return rx - ry || cx - cy;
});

const rows = keys.map((k) => {
  const a = mapA.get(k) ?? null;
  const b = mapB.get(k) ?? null;
  return {
    case: k,
    [labelA]: a,
    [labelB]: b,
    delta: {
      success_rate: pctDelta(a?.success_rate, b?.success_rate),
      p95_ms: pctDelta(a?.p95_ms, b?.p95_ms),
      p99_ms: pctDelta(a?.p99_ms, b?.p99_ms),
      avg_ms: pctDelta(a?.avg_ms, b?.avg_ms),
      max_ms: pctDelta(a?.max_ms, b?.max_ms),
    },
  };
});

const output = {
  compared_at: new Date().toISOString(),
  labels: { a: labelA, b: labelB },
  baseline_a_dir: dirA,
  baseline_b_dir: dirB,
  rows,
};

console.log(JSON.stringify(output, null, 2));


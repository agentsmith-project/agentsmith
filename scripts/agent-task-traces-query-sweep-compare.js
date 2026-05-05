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

function pctDelta(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a === 0) {
    return null;
  }
  return Number((((b - a) / a) * 100).toFixed(2));
}

const dirA = process.env.SWEEP_A_DIR;
const dirB = process.env.SWEEP_B_DIR;
const labelA = process.env.SWEEP_A_LABEL || 'A';
const labelB = process.env.SWEEP_B_LABEL || 'B';

if (!dirA || !dirB) {
  console.error('[sweep-compare] SWEEP_A_DIR and SWEEP_B_DIR are required');
  process.exit(1);
}

const fileA = path.join(dirA, 'summary.jsonl');
const fileB = path.join(dirB, 'summary.jsonl');
if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
  console.error(`[sweep-compare] summary.jsonl missing:\n- ${fileA}\n- ${fileB}`);
  process.exit(1);
}

const rowsA = readJsonl(fileA);
const rowsB = readJsonl(fileB);
const mapA = new Map(rowsA.map((r) => [String(r.page_size), r]));
const mapB = new Map(rowsB.map((r) => [String(r.page_size), r]));
const pages = [...new Set([...mapA.keys(), ...mapB.keys()])].map(Number).sort((a,b)=>a-b);

const rows = pages.map((page) => {
  const a = mapA.get(String(page)) || null;
  const b = mapB.get(String(page)) || null;
  return {
    page_size: page,
    [labelA]: a ? {
      success_rate: a.success_rate,
      avg_ms: a.latency_ms?.avg ?? null,
      p95_ms: a.latency_ms?.p95 ?? null,
      p99_ms: a.latency_ms?.p99 ?? null,
      max_ms: a.latency_ms?.max ?? null,
      requests: a.expected,
      concurrency: a.concurrency,
    } : null,
    [labelB]: b ? {
      success_rate: b.success_rate,
      avg_ms: b.latency_ms?.avg ?? null,
      p95_ms: b.latency_ms?.p95 ?? null,
      p99_ms: b.latency_ms?.p99 ?? null,
      max_ms: b.latency_ms?.max ?? null,
      requests: b.expected,
      concurrency: b.concurrency,
    } : null,
    delta_pct: {
      avg_ms: pctDelta(a?.latency_ms?.avg, b?.latency_ms?.avg),
      p95_ms: pctDelta(a?.latency_ms?.p95, b?.latency_ms?.p95),
      p99_ms: pctDelta(a?.latency_ms?.p99, b?.latency_ms?.p99),
      max_ms: pctDelta(a?.latency_ms?.max, b?.latency_ms?.max),
      success_rate: pctDelta(a?.success_rate, b?.success_rate),
    },
  };
});

console.log(JSON.stringify({
  compared_at: new Date().toISOString(),
  labels: { a: labelA, b: labelB },
  sweep_a_dir: dirA,
  sweep_b_dir: dirB,
  rows,
}, null, 2));


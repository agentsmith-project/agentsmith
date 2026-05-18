import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listVisualBaselineCatalogEntries,
  type VisualBaselineTheme,
} from '../e2e/visual-baseline-support';

export type FocusedVisualSelectionStatus = 'passed' | 'failed';

export type FocusedVisualSelectionReason =
  | 'focused_visual_selection_exact'
  | 'focused_visual_expected_set_empty'
  | 'focused_visual_disallows_allow_empty_selection'
  | 'playwright_list_failed'
  | 'playwright_list_unparseable_visual_title'
  | 'focused_visual_expected_set_unknown_catalog_entry'
  | 'focused_visual_selected_unknown_catalog_entry'
  | 'focused_visual_selection_mismatch';

export type FocusedVisualSelectionEntry = {
  key: string;
  scenarioId: string;
  theme: VisualBaselineTheme;
};

export type FocusedVisualSelectionParseError = {
  line: string;
  reason: 'unparseable_visual_story_title';
};

export type FocusedVisualSelectionEvaluation = {
  schema: 'focused_visual_selection/v1';
  status: FocusedVisualSelectionStatus;
  reason: FocusedVisualSelectionReason;
  expectedSet: FocusedVisualSelectionEntry[];
  matchedSet: FocusedVisualSelectionEntry[];
  missingSet: FocusedVisualSelectionEntry[];
  extraSet: FocusedVisualSelectionEntry[];
  unknownExpectedSet: FocusedVisualSelectionEntry[];
  unknownMatchedSet: FocusedVisualSelectionEntry[];
  parseErrors: FocusedVisualSelectionParseError[];
  listExitCode: number;
  allowEmptySelectionRequested: boolean;
};

export type FocusedVisualSelectionEvidence = FocusedVisualSelectionEvaluation & {
  generatedAt: string;
  argv: string[];
  grep: string[];
  project: string[];
  listLog: string;
  matchedCount: number;
  expected_set: FocusedVisualSelectionEntry[];
  matched_set: FocusedVisualSelectionEntry[];
  missing_set: FocusedVisualSelectionEntry[];
  extra_set: FocusedVisualSelectionEntry[];
  unknown_expected_set: FocusedVisualSelectionEntry[];
  unknown_matched_set: FocusedVisualSelectionEntry[];
  parse_errors: FocusedVisualSelectionParseError[];
  list_exit_code: number;
  allow_empty_selection_requested: boolean;
  matched_count: number;
};

type FocusedVisualSelectionEvaluateInput = {
  expectedSet: string | readonly string[];
  listOutput: string;
  listExitCode: number;
  allowEmptySelectionRequested: boolean;
};

type CliOptions = {
  expected: string;
  evidence: string;
  listLog: string;
  listExitCode: number;
  allowEmptySelectionRequested: boolean;
  argv: string[];
};

const KEY_PATTERN = /^([a-z0-9][a-z0-9-]*):(default|light|dark)$/u;
const VISUAL_TITLE_PATTERN =
  /Visual - Story Catalog Scenes[\s\S]*?\u203a\s+([a-z0-9][a-z0-9-]*)\s+\[(default|light|dark)\]\s*$/u;

function compareEntries(left: FocusedVisualSelectionEntry, right: FocusedVisualSelectionEntry): number {
  return left.key.localeCompare(right.key);
}

function toEntry(scenarioId: string, theme: VisualBaselineTheme): FocusedVisualSelectionEntry {
  return {
    key: `${scenarioId}:${theme}`,
    scenarioId,
    theme,
  };
}

function uniqueSortedEntries(entries: readonly FocusedVisualSelectionEntry[]): FocusedVisualSelectionEntry[] {
  const keyed = new Map<string, FocusedVisualSelectionEntry>();
  for (const entry of entries) {
    keyed.set(entry.key, entry);
  }
  return [...keyed.values()].sort(compareEntries);
}

function catalogKeySet(): Set<string> {
  return new Set(
    listVisualBaselineCatalogEntries().map((entry) => `${entry.scenarioId}:${entry.theme}`),
  );
}

export function parseFocusedVisualExpectedSet(value: string | readonly string[]): FocusedVisualSelectionEntry[] {
  const rawEntries: readonly string[] = typeof value === 'string'
    ? value.split(/[\s,]+/u)
    : value;
  const entries: FocusedVisualSelectionEntry[] = [];

  for (const rawEntry of rawEntries) {
    const trimmed = rawEntry.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(KEY_PATTERN);
    if (!match) {
      throw new Error(`invalid focused visual expected entry: ${trimmed}`);
    }
    entries.push(toEntry(match[1], match[2] as VisualBaselineTheme));
  }

  return uniqueSortedEntries(entries);
}

export function parsePlaywrightVisualListOutput(output: string): {
  matchedSet: FocusedVisualSelectionEntry[];
  parseErrors: FocusedVisualSelectionParseError[];
} {
  const matchedEntries: FocusedVisualSelectionEntry[] = [];
  const parseErrors: FocusedVisualSelectionParseError[] = [];

  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes('Visual - Story Catalog Scenes')) {
      continue;
    }

    const match = line.match(VISUAL_TITLE_PATTERN);
    if (!match) {
      parseErrors.push({
        line,
        reason: 'unparseable_visual_story_title',
      });
      continue;
    }

    matchedEntries.push(toEntry(match[1], match[2] as VisualBaselineTheme));
  }

  return {
    matchedSet: uniqueSortedEntries(matchedEntries),
    parseErrors,
  };
}

export function evaluateFocusedVisualSelection(
  input: FocusedVisualSelectionEvaluateInput,
): FocusedVisualSelectionEvaluation {
  const expectedSet = parseFocusedVisualExpectedSet(input.expectedSet);
  const { matchedSet, parseErrors } = parsePlaywrightVisualListOutput(input.listOutput);
  const expectedKeys = new Set(expectedSet.map((entry) => entry.key));
  const matchedKeys = new Set(matchedSet.map((entry) => entry.key));
  const knownCatalogKeys = catalogKeySet();
  const missingSet = expectedSet.filter((entry) => !matchedKeys.has(entry.key));
  const extraSet = matchedSet.filter((entry) => !expectedKeys.has(entry.key));
  const unknownExpectedSet = expectedSet.filter((entry) => !knownCatalogKeys.has(entry.key));
  const unknownMatchedSet = matchedSet.filter((entry) => !knownCatalogKeys.has(entry.key));

  let reason: FocusedVisualSelectionReason = 'focused_visual_selection_exact';
  if (expectedSet.length === 0) {
    reason = 'focused_visual_expected_set_empty';
  } else if (input.allowEmptySelectionRequested) {
    reason = 'focused_visual_disallows_allow_empty_selection';
  } else if (input.listExitCode !== 0) {
    reason = 'playwright_list_failed';
  } else if (parseErrors.length > 0) {
    reason = 'playwright_list_unparseable_visual_title';
  } else if (unknownExpectedSet.length > 0) {
    reason = 'focused_visual_expected_set_unknown_catalog_entry';
  } else if (unknownMatchedSet.length > 0) {
    reason = 'focused_visual_selected_unknown_catalog_entry';
  } else if (missingSet.length > 0 || extraSet.length > 0) {
    reason = 'focused_visual_selection_mismatch';
  }

  return {
    schema: 'focused_visual_selection/v1',
    status: reason === 'focused_visual_selection_exact' ? 'passed' : 'failed',
    reason,
    expectedSet,
    matchedSet,
    missingSet,
    extraSet,
    unknownExpectedSet,
    unknownMatchedSet,
    parseErrors,
    listExitCode: input.listExitCode,
    allowEmptySelectionRequested: input.allowEmptySelectionRequested,
  };
}

function argValues(argv: readonly string[], longName: string, shortName?: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === longName || (shortName && arg === shortName)) {
      if (index + 1 < argv.length) {
        values.push(argv[index + 1]);
        index += 1;
      }
      continue;
    }
    const longPrefix = `${longName}=`;
    if (arg.startsWith(longPrefix)) {
      values.push(arg.slice(longPrefix.length));
      continue;
    }
    if (shortName) {
      const shortPrefix = `${shortName}=`;
      if (arg.startsWith(shortPrefix)) {
        values.push(arg.slice(shortPrefix.length));
      }
    }
  }
  return values;
}

export function buildFocusedVisualSelectionEvidence(args: {
  evaluation: FocusedVisualSelectionEvaluation;
  argv: readonly string[];
  listLog: string;
  generatedAt?: string;
}): FocusedVisualSelectionEvidence {
  return {
    ...args.evaluation,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    argv: [...args.argv],
    grep: argValues(args.argv, '--grep', '-g'),
    project: argValues(args.argv, '--project'),
    listLog: args.listLog,
    matchedCount: args.evaluation.matchedSet.length,
    expected_set: args.evaluation.expectedSet,
    matched_set: args.evaluation.matchedSet,
    missing_set: args.evaluation.missingSet,
    extra_set: args.evaluation.extraSet,
    unknown_expected_set: args.evaluation.unknownExpectedSet,
    unknown_matched_set: args.evaluation.unknownMatchedSet,
    parse_errors: args.evaluation.parseErrors,
    list_exit_code: args.evaluation.listExitCode,
    allow_empty_selection_requested: args.evaluation.allowEmptySelectionRequested,
    matched_count: args.evaluation.matchedSet.length,
  };
}

function parseBooleanFlag(value: string): boolean {
  return value === '1' || value === 'true';
}

function readRequiredFlag(args: {
  name: string;
  value: string | undefined;
}): string {
  if (!args.value) {
    throw new Error(`missing required ${args.name}`);
  }
  return args.value;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let expected: string | undefined;
  let evidence: string | undefined;
  let listLog: string | undefined;
  let listExitCode: number | undefined;
  let allowEmptySelectionRequested = false;
  const playwrightArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      playwrightArgs.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--expected') {
      expected = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--expected=')) {
      expected = arg.slice('--expected='.length);
      continue;
    }
    if (arg === '--evidence') {
      evidence = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--evidence=')) {
      evidence = arg.slice('--evidence='.length);
      continue;
    }
    if (arg === '--list-log') {
      listLog = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--list-log=')) {
      listLog = arg.slice('--list-log='.length);
      continue;
    }
    if (arg === '--list-exit-code') {
      listExitCode = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--list-exit-code=')) {
      listExitCode = Number(arg.slice('--list-exit-code='.length));
      continue;
    }
    if (arg === '--allow-empty-requested') {
      allowEmptySelectionRequested = parseBooleanFlag(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg.startsWith('--allow-empty-requested=')) {
      allowEmptySelectionRequested = parseBooleanFlag(arg.slice('--allow-empty-requested='.length));
      continue;
    }
    throw new Error(`unknown focused visual selection argument: ${arg}`);
  }

  if (typeof listExitCode !== 'number' || !Number.isInteger(listExitCode)) {
    throw new Error('missing required --list-exit-code');
  }

  return {
    expected: readRequiredFlag({ name: '--expected', value: expected }),
    evidence: readRequiredFlag({ name: '--evidence', value: evidence }),
    listLog: readRequiredFlag({ name: '--list-log', value: listLog }),
    listExitCode,
    allowEmptySelectionRequested,
    argv: playwrightArgs,
  };
}

function writeJsonFile(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function formatEntryKeys(entries: readonly FocusedVisualSelectionEntry[]): string {
  return entries.length > 0 ? entries.map((entry) => entry.key).join(', ') : '<none>';
}

export function runFocusedVisualSelectionCli(argv: readonly string[]): number {
  const options = parseCliOptions(argv);
  const listOutput = readFileSync(options.listLog, 'utf8');
  const evaluation = evaluateFocusedVisualSelection({
    expectedSet: options.expected,
    listOutput,
    listExitCode: options.listExitCode,
    allowEmptySelectionRequested: options.allowEmptySelectionRequested,
  });
  const evidence = buildFocusedVisualSelectionEvidence({
    evaluation,
    argv: options.argv,
    listLog: options.listLog,
  });
  writeJsonFile(options.evidence, evidence);

  if (evaluation.status === 'passed') {
    console.log(
      `[focused-visual] selected scenario/theme set matched expected set (${evaluation.matchedSet.length}); evidence: ${options.evidence}`,
    );
    return 0;
  }

  console.error(
    [
      `[focused-visual] selected scenario/theme set did not match expected set; reason=${evaluation.reason}`,
      `matched=${formatEntryKeys(evaluation.matchedSet)}`,
      `missing=${formatEntryKeys(evaluation.missingSet)}`,
      `extra=${formatEntryKeys(evaluation.extraSet)}`,
      `evidence=${options.evidence}`,
    ].join('\n'),
  );
  return 1;
}

const invokedAsCli = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsCli) {
  try {
    process.exitCode = runFocusedVisualSelectionCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

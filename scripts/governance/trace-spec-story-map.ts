import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

import type { StoryDefinition } from '../../e2e/story-contract';
import { loadCommittedStoryDefinitionsSync } from '../story-catalog-support';

export const TRACE_SPEC_STORY_BINDING_SCANNER_PATH = 'scripts/governance/trace-spec-story-map.ts' as const;
export const TRACE_SPEC_STORY_BINDING_SOURCE_GLOB = 'e2e/integration*.spec.ts' as const;
export const TRACE_SPEC_STORY_BINDING_CONTRACT =
  'createUxTraceBundleWriter({ specFile, storyId, storyBinding })' as const;

export type TraceSpecStoryBindingSourceTruth = {
  kind: 'trace_spec_story_binding';
  scanner: typeof TRACE_SPEC_STORY_BINDING_SCANNER_PATH;
  bindingContract: typeof TRACE_SPEC_STORY_BINDING_CONTRACT;
  usedAsStoryTruth: false;
};

export type TraceSpecStoryMapEntry = {
  specFile: string;
  storyId: string;
  storySourceFile: string;
  sourceTruth: TraceSpecStoryBindingSourceTruth;
};

export type TraceSpecStoryMapUnresolvedBinding = {
  sourceFile: string;
  line: number;
  reason: string;
};

export type TraceSpecStoryMapScanResult = {
  entries: readonly TraceSpecStoryMapEntry[];
  unresolved: readonly TraceSpecStoryMapUnresolvedBinding[];
  summary: {
    specCount: number;
    bindingCount: number;
    unresolvedCount: number;
  };
};

export type TraceSpecStoryMapSourceText = {
  filePath: string;
  text: string;
};

export type TraceSpecStoryMapScanInput = {
  cwd?: string;
  stories?: readonly StoryDefinition[];
  sourceFiles?: readonly string[];
  sourceTexts?: readonly TraceSpecStoryMapSourceText[];
};

type CanonicalStoryLookup = {
  storyIds: ReadonlySet<string>;
  storyById: ReadonlyMap<string, StoryDefinition>;
  storyIdBySourceFile: ReadonlyMap<string, string>;
  cwd: string;
};

type SourceScanState = {
  canonicalStories: CanonicalStoryLookup;
  constStrings: Map<string, string>;
  storyIdentifiers: Map<string, string>;
  storyObjectIdentifiers: Map<string, string>;
  bindingIdentifiers: Map<string, string>;
  sourceFile: ts.SourceFile;
  sourcePath: string;
};

function normalizeRepoPath(value: string, cwd = process.cwd()): string {
  const normalized = value.replaceAll('\\', '/').trim();
  if (!normalized) {
    return normalized;
  }
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(cwd, normalized);
  const relative = path.relative(cwd, absolute).replaceAll('\\', '/');
  if (relative.startsWith('../')) {
    return normalized.startsWith('./') ? normalized.slice(2) : normalized;
  }
  return relative;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createSourceTruth(): TraceSpecStoryBindingSourceTruth {
  return {
    kind: 'trace_spec_story_binding',
    scanner: TRACE_SPEC_STORY_BINDING_SCANNER_PATH,
    bindingContract: TRACE_SPEC_STORY_BINDING_CONTRACT,
    usedAsStoryTruth: false,
  };
}

function canonicalStorySource(story: StoryDefinition, cwd: string): string {
  return normalizeRepoPath(story.sourceFile ?? story.filePath, cwd);
}

function createCanonicalStoryLookup(
  stories: readonly StoryDefinition[],
  cwd: string,
): CanonicalStoryLookup {
  const storyById = new Map<string, StoryDefinition>();
  const storyIdBySourceFile = new Map<string, string>();
  for (const story of stories) {
    storyById.set(story.storyId, story);
    storyIdBySourceFile.set(canonicalStorySource(story, cwd), story.storyId);
    storyIdBySourceFile.set(normalizeRepoPath(story.filePath, cwd), story.storyId);
  }

  return {
    storyIds: new Set(storyById.keys()),
    storyById,
    storyIdBySourceFile,
    cwd,
  };
}

function storyIdFromMarkdownBasename(value: string): string | undefined {
  const suffix = '.story.md';
  const baseName = path.basename(value.replaceAll('\\', '/'));
  if (!baseName.endsWith(suffix)) {
    return undefined;
  }
  return baseName.slice(0, -suffix.length);
}

function resolveCanonicalStoryId(
  value: string,
  lookup: CanonicalStoryLookup,
): string | undefined {
  const trimmed = value.trim();
  if (lookup.storyIds.has(trimmed)) {
    return trimmed;
  }

  const sourceWithoutHash = trimmed.split('#', 1)[0] ?? trimmed;
  const normalizedSource = normalizeRepoPath(sourceWithoutHash, lookup.cwd);
  const sourceMatch = lookup.storyIdBySourceFile.get(normalizedSource);
  if (sourceMatch) {
    return sourceMatch;
  }

  const basenameStoryId = storyIdFromMarkdownBasename(sourceWithoutHash);
  if (basenameStoryId && lookup.storyIds.has(basenameStoryId)) {
    return basenameStoryId;
  }

  return undefined;
}

function resolveCanonicalStoryIdOrThrow(
  value: string,
  lookup: CanonicalStoryLookup,
): string {
  const storyId = resolveCanonicalStoryId(value, lookup);
  if (!storyId) {
    throw new Error(`unknown trace spec story id: ${value}`);
  }
  return storyId;
}

function sourcePosition(sourceFile: ts.SourceFile, node: ts.Node): { line: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: position.line + 1,
  };
}

function expressionText(expression: ts.Expression): string {
  return expression.getText();
}

function isIdentifierNamed(expression: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expression) && expression.text === name;
}

function isCallNamed(expression: ts.Expression, name: string): boolean {
  return isIdentifierNamed(expression, name);
}

function isPathUtilityCall(expression: ts.Expression, methodName: 'join' | 'resolve'): boolean {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === methodName
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'path';
}

function resolveImportModuleFile(
  moduleSpecifier: string,
  importerPath: string,
  cwd: string,
): string | undefined {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined;
  }

  const importerAbsolutePath = path.resolve(cwd, normalizeRepoPath(importerPath, cwd));
  const basePath = path.resolve(path.dirname(importerAbsolutePath), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveStringExpression(
  expression: ts.Expression,
  state: SourceScanState,
): string | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    return state.constStrings.get(expression.text);
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return resolveStringExpression(expression.expression, state);
  }
  if (
    ts.isCallExpression(expression)
    && (isPathUtilityCall(expression.expression, 'join') || isPathUtilityCall(expression.expression, 'resolve'))
  ) {
    const parts = expression.arguments
      .map((argument) => resolveStringExpression(argument, state))
      .filter((part): part is string => Boolean(part));
    if (parts.length === 0) {
      return undefined;
    }
    return path.join(...parts);
  }
  if (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStringExpression(expression.left, state);
    const right = resolveStringExpression(expression.right, state);
    return left !== undefined && right !== undefined ? `${left}${right}` : undefined;
  }
  return undefined;
}

function resolveStoryDefinitionExpression(
  expression: ts.Expression,
  state: SourceScanState,
): string | undefined {
  if (ts.isIdentifier(expression)) {
    return state.storyIdentifiers.get(expression.text);
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'storyDefinition'
    && ts.isIdentifier(expression.expression)
  ) {
    return state.storyObjectIdentifiers.get(expression.expression.text);
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return resolveStoryDefinitionExpression(expression.expression, state);
  }
  if (ts.isCallExpression(expression) && isCallNamed(expression.expression, 'loadStoryDefinitionSync')) {
    const [storyReference] = expression.arguments;
    const value = storyReference ? resolveStringExpression(storyReference, state) : undefined;
    return value ? resolveCanonicalStoryIdOrThrow(value, state.canonicalStories) : undefined;
  }
  if (ts.isCallExpression(expression) && isCallNamed(expression.expression, 'readStoryDefinitionFromMarkdownFileSync')) {
    const [storyReference] = expression.arguments;
    const value = storyReference ? resolveStringExpression(storyReference, state) : undefined;
    return value ? resolveCanonicalStoryIdOrThrow(value, state.canonicalStories) : undefined;
  }
  return undefined;
}

function resolveTraceBindingExpression(
  expression: ts.Expression,
  state: SourceScanState,
): string | undefined {
  if (ts.isIdentifier(expression)) {
    return state.bindingIdentifiers.get(expression.text);
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return resolveTraceBindingExpression(expression.expression, state);
  }
  if (ts.isCallExpression(expression) && isCallNamed(expression.expression, 'buildTraceStoryBinding')) {
    const [storyExpression] = expression.arguments;
    return storyExpression ? resolveStoryDefinitionExpression(storyExpression, state) : undefined;
  }
  return undefined;
}

function resolveStoryIdExpression(
  expression: ts.Expression,
  state: SourceScanState,
): string | undefined {
  const literalStoryReference = resolveStringExpression(expression, state);
  if (literalStoryReference !== undefined) {
    return resolveCanonicalStoryIdOrThrow(literalStoryReference, state.canonicalStories);
  }

  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'storyId') {
    const receiver = expression.expression;
    if (ts.isIdentifier(receiver)) {
      return state.storyIdentifiers.get(receiver.text) ?? state.bindingIdentifiers.get(receiver.text);
    }
    if (
      ts.isPropertyAccessExpression(receiver)
      && receiver.name.text === 'manifest'
      && ts.isIdentifier(receiver.expression)
    ) {
      return state.storyObjectIdentifiers.get(receiver.expression.text);
    }
  }

  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return resolveStoryIdExpression(expression.expression, state);
  }

  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function findObjectPropertyExpression(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      if (name === propertyName) {
        return property.initializer;
      }
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return property.name;
    }
  }
  return undefined;
}

function resolveStoryObjectLiteral(
  objectLiteral: ts.ObjectLiteralExpression,
  state: SourceScanState,
): string | undefined {
  const manifestExpression = findObjectPropertyExpression(objectLiteral, 'manifest');
  const storyDefinitionExpression = findObjectPropertyExpression(objectLiteral, 'storyDefinition');
  const manifestStoryId = manifestExpression && ts.isObjectLiteralExpression(manifestExpression)
    ? resolveStoryIdExpression(
      findObjectPropertyExpression(manifestExpression, 'storyId') ?? manifestExpression,
      state,
    )
    : undefined;
  const storyDefinitionId = storyDefinitionExpression
    ? resolveStoryDefinitionExpression(storyDefinitionExpression, state)
    : undefined;

  if (manifestStoryId && storyDefinitionId && manifestStoryId !== storyDefinitionId) {
    throw new Error(
      `trace spec imported story object mismatch in ${state.sourcePath}: `
      + `manifest.storyId=${manifestStoryId}, storyDefinition=${storyDefinitionId}`,
    );
  }

  return manifestStoryId ?? storyDefinitionId;
}

function objectLiteralFromExpression(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) {
    return expression;
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return objectLiteralFromExpression(expression.expression);
  }
  return undefined;
}

function resolveImportedStoryObjectId(args: {
  moduleSpecifier: string;
  importedName: string;
  importerPath: string;
  lookup: CanonicalStoryLookup;
}): string | undefined {
  const moduleFile = resolveImportModuleFile(args.moduleSpecifier, args.importerPath, args.lookup.cwd);
  if (!moduleFile) {
    return undefined;
  }
  const sourcePath = normalizeRepoPath(moduleFile, args.lookup.cwd);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(moduleFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const state: SourceScanState = {
    canonicalStories: args.lookup,
    constStrings: new Map<string, string>(),
    storyIdentifiers: new Map<string, string>(),
    storyObjectIdentifiers: new Map<string, string>(),
    bindingIdentifiers: new Map<string, string>(),
    sourceFile,
    sourcePath,
  };
  let resolvedStoryId: string | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const stringValue = resolveStringExpression(node.initializer, state);
      if (stringValue !== undefined) {
        state.constStrings.set(node.name.text, stringValue);
      }

      const storyId = resolveStoryDefinitionExpression(node.initializer, state);
      if (storyId) {
        state.storyIdentifiers.set(node.name.text, storyId);
      }

      const objectLiteral = objectLiteralFromExpression(node.initializer);
      if (node.name.text === args.importedName && objectLiteral) {
        resolvedStoryId = resolveStoryObjectLiteral(objectLiteral, state);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return resolvedStoryId;
}

function resolveImportedStoryObjects(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  lookup: CanonicalStoryLookup,
  candidateNames: ReadonlySet<string>,
): Map<string, string> {
  const storyObjects = new Map<string, string>();
  if (candidateNames.size === 0) {
    return storyObjects;
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }
    for (const element of namedBindings.elements) {
      if (!candidateNames.has(element.name.text)) {
        continue;
      }
      const importedName = element.propertyName?.text ?? element.name.text;
      const storyId = resolveImportedStoryObjectId({
        moduleSpecifier: statement.moduleSpecifier.text,
        importedName,
        importerPath: sourcePath,
        lookup,
      });
      if (storyId) {
        storyObjects.set(element.name.text, storyId);
      }
    }
  }
  return storyObjects;
}

function collectImportedStoryObjectCandidateNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const candidates = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && node.name.text === 'storyDefinition'
      && ts.isIdentifier(node.expression)
    ) {
      candidates.add(node.expression.text);
    }
    if (
      ts.isPropertyAccessExpression(node)
      && node.name.text === 'storyId'
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'manifest'
      && ts.isIdentifier(node.expression.expression)
    ) {
      candidates.add(node.expression.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function scanSourceText(
  sourceText: TraceSpecStoryMapSourceText,
  lookup: CanonicalStoryLookup,
): {
  entries: TraceSpecStoryMapEntry[];
  unresolved: TraceSpecStoryMapUnresolvedBinding[];
} {
  const sourceFile = ts.createSourceFile(
    sourceText.filePath,
    sourceText.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const actualSourceFile = normalizeRepoPath(sourceText.filePath, lookup.cwd);
  const state: SourceScanState = {
    canonicalStories: lookup,
    constStrings: new Map<string, string>(),
    storyIdentifiers: new Map<string, string>(),
    storyObjectIdentifiers: resolveImportedStoryObjects(
      sourceFile,
      actualSourceFile,
      lookup,
      collectImportedStoryObjectCandidateNames(sourceFile),
    ),
    bindingIdentifiers: new Map<string, string>(),
    sourceFile,
    sourcePath: actualSourceFile,
  };
  const entries: TraceSpecStoryMapEntry[] = [];
  const unresolved: TraceSpecStoryMapUnresolvedBinding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const stringValue = resolveStringExpression(node.initializer, state);
      if (stringValue !== undefined) {
        state.constStrings.set(node.name.text, stringValue);
      }

      const storyId = resolveStoryDefinitionExpression(node.initializer, state);
      if (storyId) {
        state.storyIdentifiers.set(node.name.text, storyId);
      }

      const bindingStoryId = resolveTraceBindingExpression(node.initializer, state);
      if (bindingStoryId) {
        state.bindingIdentifiers.set(node.name.text, bindingStoryId);
      }
    }

    if (ts.isCallExpression(node) && isCallNamed(node.expression, 'createUxTraceBundleWriter')) {
      const [optionsExpression] = node.arguments;
      if (!optionsExpression || !ts.isObjectLiteralExpression(optionsExpression)) {
        const position = sourcePosition(sourceFile, node);
        unresolved.push({
          sourceFile: actualSourceFile,
          line: position.line,
          reason: 'createUxTraceBundleWriter options are not an object literal',
        });
      } else {
        const specFileExpression = findObjectPropertyExpression(optionsExpression, 'specFile');
        const storyIdExpression = findObjectPropertyExpression(optionsExpression, 'storyId');
        const storyBindingExpression = findObjectPropertyExpression(optionsExpression, 'storyBinding');
        const specFile = specFileExpression
          ? resolveStringExpression(specFileExpression, state)
          : undefined;
        const declaredSpecFile = specFile
          ? normalizeRepoPath(specFile, lookup.cwd)
          : undefined;
        const storyIdFromProperty = storyIdExpression
          ? resolveStoryIdExpression(storyIdExpression, state)
          : undefined;
        const storyIdFromBinding = storyBindingExpression
          ? resolveTraceBindingExpression(storyBindingExpression, state)
          : undefined;
        const position = sourcePosition(sourceFile, node);

        if (storyIdFromProperty && storyIdFromBinding && storyIdFromProperty !== storyIdFromBinding) {
          throw new Error(
            `trace spec story binding mismatch in ${sourceText.filePath}:${position.line}: `
            + `${expressionText(storyIdExpression ?? node)} resolved to ${storyIdFromProperty}, `
            + `${expressionText(storyBindingExpression ?? node)} resolved to ${storyIdFromBinding}`,
          );
        }

        if (declaredSpecFile && declaredSpecFile !== actualSourceFile) {
          throw new Error(
            `trace spec specFile metadata mismatch in current source file ${actualSourceFile}:${position.line}: `
            + `declared specFile=${declaredSpecFile}, actual source file=${actualSourceFile}`,
          );
        }

        if (!declaredSpecFile || !storyIdFromProperty || !storyIdFromBinding) {
          unresolved.push({
            sourceFile: actualSourceFile,
            line: position.line,
            reason: [
              !declaredSpecFile ? 'specFile metadata could not be resolved' : undefined,
              !storyIdFromProperty ? 'storyId metadata could not be resolved' : undefined,
              !storyIdFromBinding ? 'storyBinding metadata could not be resolved' : undefined,
            ].filter((reason): reason is string => Boolean(reason)).join('; '),
          });
        } else {
          const canonicalStory = lookup.storyById.get(storyIdFromProperty);
          if (!canonicalStory) {
            throw new Error(`unknown trace spec story id: ${storyIdFromProperty}`);
          }
          entries.push({
            specFile: declaredSpecFile,
            storyId: storyIdFromProperty,
            storySourceFile: canonicalStorySource(canonicalStory, lookup.cwd),
            sourceTruth: createSourceTruth(),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { entries, unresolved };
}

function formatUnresolvedBindings(
  unresolved: readonly TraceSpecStoryMapUnresolvedBinding[],
): string {
  return unresolved
    .map((entry) => `- ${entry.sourceFile}:${entry.line}: ${entry.reason}`)
    .join('\n');
}

function listDefaultTraceSpecFiles(cwd: string): string[] {
  const e2eRoot = path.resolve(cwd, 'e2e');
  if (!existsSync(e2eRoot)) {
    return [];
  }
  return readdirSync(e2eRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith('integration') && name.endsWith('.spec.ts'))
    .map((name) => normalizeRepoPath(path.join('e2e', name), cwd))
    .sort((left, right) => left.localeCompare(right));
}

function readSourceTexts(
  sourceFiles: readonly string[],
  cwd: string,
): TraceSpecStoryMapSourceText[] {
  return sourceFiles.map((filePath) => {
    const repoPath = normalizeRepoPath(filePath, cwd);
    return {
      filePath: repoPath,
      text: readFileSync(path.resolve(cwd, repoPath), 'utf8'),
    };
  });
}

export function scanTraceSpecStoryMap(
  input: TraceSpecStoryMapScanInput = {},
): TraceSpecStoryMapScanResult {
  const cwd = input.cwd ?? process.cwd();
  const stories = input.stories ?? loadCommittedStoryDefinitionsSync();
  const lookup = createCanonicalStoryLookup(stories, cwd);
  const sourceTexts = input.sourceTexts
    ?? readSourceTexts(input.sourceFiles ?? listDefaultTraceSpecFiles(cwd), cwd);
  const entries: TraceSpecStoryMapEntry[] = [];
  const unresolved: TraceSpecStoryMapUnresolvedBinding[] = [];

  for (const sourceText of sourceTexts) {
    const result = scanSourceText(sourceText, lookup);
    entries.push(...result.entries);
    unresolved.push(...result.unresolved);
  }

  if (unresolved.length > 0) {
    throw new Error(
      `unresolved trace spec story binding(s) found:\n${formatUnresolvedBindings(unresolved)}`,
    );
  }

  const dedupedEntries = [...new Map(
    entries.map((entry) => [`${entry.specFile}\0${entry.storyId}`, entry] as const),
  ).values()].sort((left, right) => (
    left.specFile.localeCompare(right.specFile)
    || left.storyId.localeCompare(right.storyId)
  ));
  const specFiles = uniqueSorted(dedupedEntries.map((entry) => entry.specFile));

  return {
    entries: dedupedEntries,
    unresolved,
    summary: {
      specCount: specFiles.length,
      bindingCount: dedupedEntries.length,
      unresolvedCount: unresolved.length,
    },
  };
}

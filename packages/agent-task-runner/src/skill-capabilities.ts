import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const SKILL_CONTRACT_FILENAME = 'capabilities.json';

export type SkillContextScope = 'member' | 'task' | 'project_member' | 'project' | 'workspace';

export type SimpleCredentialFieldDependency = {
  name: string;
  keys: string[];
  required: boolean;
};

export type SimpleCredentialBundleDependency = {
  name: string;
  kind: 'simple_credential_bundle';
  scopes: SkillContextScope[];
  fields: SimpleCredentialFieldDependency[];
};

export type ManagedCredentialDependency = {
  name: string;
  kind: 'managed_credential';
  provider: string;
  scope: Extract<SkillContextScope, 'member' | 'project_member'>;
  refresh_supported: boolean;
};

export type BuiltinSkillDependency =
  | SimpleCredentialBundleDependency
  | ManagedCredentialDependency;

export type ContextStoreProviderCapability = {
  kind: 'context_store';
  scopes: SkillContextScope[];
  direct_access: boolean;
  writable_scopes: Array<Extract<SkillContextScope, 'member' | 'task' | 'project_member'>>;
};

export type ManagedCredentialRefreshCapability = {
  kind: 'managed_credential_refresh';
  providers: string[];
};

export type BuiltinSkillProvidedCapability =
  | ContextStoreProviderCapability
  | ManagedCredentialRefreshCapability;

export type BuiltinSkillCapabilityContract = {
  version: 1;
  skill_name: string;
  dependencies: BuiltinSkillDependency[];
  provides?: BuiltinSkillProvidedCapability[];
};

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readScopeArray(value: unknown, fieldName: string): SkillContextScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`skill_contract_invalid:${fieldName}`);
  }
  const scopes = value.map((item) => readTrimmedString(item));
  if (scopes.some((item) => item === null)) {
    throw new Error(`skill_contract_invalid:${fieldName}`);
  }
  const unique = Array.from(new Set(scopes)) as string[];
  const invalid = unique.find((item) => !['member', 'task', 'project_member', 'project', 'workspace'].includes(item));
  if (invalid) {
    throw new Error(`skill_contract_invalid:${fieldName}`);
  }
  return unique as SkillContextScope[];
}

function parseSimpleCredentialFieldDependency(input: unknown, fieldName: string): SimpleCredentialFieldDependency {
  if (!isPlainObject(input)) {
    throw new Error(`skill_contract_invalid:${fieldName}`);
  }
  const name = readTrimmedString(input.name);
  const keys = Array.isArray(input.keys)
    ? input.keys.map((item) => readTrimmedString(item)).filter((item): item is string => item !== null)
    : [];
  if (!name || keys.length === 0) {
    throw new Error(`skill_contract_invalid:${fieldName}`);
  }
  return {
    name,
    keys: Array.from(new Set(keys)),
    required: input.required !== false,
  };
}

function parseDependency(input: unknown, index: number): BuiltinSkillDependency {
  if (!isPlainObject(input)) {
    throw new Error(`skill_contract_invalid:dependencies[${index}]`);
  }
  const name = readTrimmedString(input.name);
  const kind = readTrimmedString(input.kind);
  if (!name || !kind) {
    throw new Error(`skill_contract_invalid:dependencies[${index}]`);
  }
  if (kind === 'simple_credential_bundle') {
    const scopes = readScopeArray(input.scopes, `dependencies[${index}].scopes`);
    if (!Array.isArray(input.fields) || input.fields.length === 0) {
      throw new Error(`skill_contract_invalid:dependencies[${index}].fields`);
    }
    return {
      name,
      kind,
      scopes,
      fields: input.fields.map((item, itemIndex) =>
        parseSimpleCredentialFieldDependency(item, `dependencies[${index}].fields[${itemIndex}]`)),
    };
  }
  if (kind === 'managed_credential') {
    const provider = readTrimmedString(input.provider);
    const scope = readTrimmedString(input.scope);
    if (!provider || (scope !== 'member' && scope !== 'project_member')) {
      throw new Error(`skill_contract_invalid:dependencies[${index}]`);
    }
    return {
      name,
      kind,
      provider,
      scope,
      refresh_supported: input.refresh_supported !== false,
    };
  }
  throw new Error(`skill_contract_invalid:dependencies[${index}]`);
}

function parseProvidedCapability(input: unknown, index: number): BuiltinSkillProvidedCapability {
  if (!isPlainObject(input)) {
    throw new Error(`skill_contract_invalid:provides[${index}]`);
  }
  const kind = readTrimmedString(input.kind);
  if (kind === 'context_store') {
    return {
      kind,
      scopes: readScopeArray(input.scopes, `provides[${index}].scopes`),
      direct_access: input.direct_access !== false,
      writable_scopes: readScopeArray(
        input.writable_scopes ?? ['member', 'task'],
        `provides[${index}].writable_scopes`,
      ).filter((scope): scope is 'member' | 'task' | 'project_member' =>
        scope === 'member' || scope === 'task' || scope === 'project_member'),
    };
  }
  if (kind === 'managed_credential_refresh') {
    const providers = Array.isArray(input.providers)
      ? input.providers.map((item) => readTrimmedString(item)).filter((item): item is string => item !== null)
      : [];
    if (providers.length === 0) {
      throw new Error(`skill_contract_invalid:provides[${index}]`);
    }
    return {
      kind,
      providers: Array.from(new Set(providers)),
    };
  }
  throw new Error(`skill_contract_invalid:provides[${index}]`);
}

export function parseBuiltinSkillCapabilityContract(input: unknown): BuiltinSkillCapabilityContract {
  if (!isPlainObject(input)) {
    throw new Error('skill_contract_invalid:root');
  }
  if (input.version !== 1) {
    throw new Error('skill_contract_invalid:version');
  }
  const skillName = readTrimmedString(input.skill_name);
  if (!skillName) {
    throw new Error('skill_contract_invalid:skill_name');
  }
  if (!Array.isArray(input.dependencies)) {
    throw new Error('skill_contract_invalid:dependencies');
  }
  const dependencies = input.dependencies.map((item, index) => parseDependency(item, index));
  const provides = Array.isArray(input.provides)
    ? input.provides.map((item, index) => parseProvidedCapability(item, index))
    : undefined;
  return {
    version: 1,
    skill_name: skillName,
    dependencies,
    provides,
  };
}

export async function readBuiltinSkillCapabilityContract(skillRoot: string): Promise<BuiltinSkillCapabilityContract> {
  const path = resolve(skillRoot, SKILL_CONTRACT_FILENAME);
  const raw = await readFile(path, 'utf8');
  return parseBuiltinSkillCapabilityContract(JSON.parse(raw) as unknown);
}

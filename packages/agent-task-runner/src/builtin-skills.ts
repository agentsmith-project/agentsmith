import * as fs from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuiltinSkillCapabilityContract, type BuiltinSkillCapabilityContract } from './skill-capabilities.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FALLBACK_DEV_SKILLS_DIR = resolve(MODULE_DIR, '../builtin-skills');
const PACKAGED_IMAGE_SKILLS_DIR = '/etc/codex/skills';
const DEFAULT_BUILTIN_SKILLS = ['mbos-context', 'feishu-docs', 'jira-ops'];
const MANIFEST_FILENAME = 'builtin-skills-manifest.json';
const BUILTIN_SKILLS_LOCK_DIRNAME = '.builtin-skills-seed.lock';
const SHARED_RUNTIME_DIRNAME = '.mbos-runtime';
const BUILTIN_SKILLS_LOCK_WAIT_TIMEOUT_MS = 5_000;
const BUILTIN_SKILLS_LOCK_WAIT_INTERVAL_MS = 25;
const BUILTIN_SKILLS_LOCK_ACQUIRE_RETRY_ATTEMPTS = 5;

type BuiltinSkillManifest = {
  version: 2;
  source_dir: string;
  installed_skills: string[];
  runtime_helpers: string[];
  skill_contracts: Record<string, BuiltinSkillCapabilityContract>;
  installed_at: string;
};

function getBuiltinSkillManifestPath(manifestDir: string): string {
  return join(manifestDir, MANIFEST_FILENAME);
}

async function readBuiltinSkillManifest(manifestPath: string): Promise<BuiltinSkillManifest | null> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<BuiltinSkillManifest>;
    if (
      manifest.version !== 2
      || typeof manifest.source_dir !== 'string'
      || !Array.isArray(manifest.installed_skills)
      || !Array.isArray(manifest.runtime_helpers)
      || typeof manifest.skill_contracts !== 'object'
      || manifest.skill_contracts === null
      || typeof manifest.installed_at !== 'string'
    ) {
      return null;
    }
    return manifest as BuiltinSkillManifest;
  } catch {
    return null;
  }
}

function manifestMatchesSeedRequest(
  manifest: BuiltinSkillManifest | null,
  sourceDir: string,
  skills: string[],
  hasSharedRuntime: boolean,
): boolean {
  if (!manifest) return false;
  if (manifest.source_dir !== sourceDir) return false;
  const expectedSkills = [...skills].sort();
  const installedSkills = [...manifest.installed_skills].sort();
  if (
    expectedSkills.length !== installedSkills.length
    || expectedSkills.some((skill, index) => skill !== installedSkills[index])
  ) {
    return false;
  }
  const expectedRuntimeHelpers = hasSharedRuntime ? [SHARED_RUNTIME_DIRNAME] : [];
  const installedRuntimeHelpers = [...manifest.runtime_helpers].sort();
  if (
    expectedRuntimeHelpers.length !== installedRuntimeHelpers.length
    || expectedRuntimeHelpers.some((helper, index) => helper !== installedRuntimeHelpers[index])
  ) {
    return false;
  }
  return true;
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireBuiltinSkillsLock(lockDir: string): Promise<boolean> {
  const lockParentDir = dirname(lockDir);
  for (let attempt = 0; attempt < BUILTIN_SKILLS_LOCK_ACQUIRE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockParentDir, { recursive: true });
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (errorCode !== 'ENOENT' || attempt === BUILTIN_SKILLS_LOCK_ACQUIRE_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(BUILTIN_SKILLS_LOCK_WAIT_INTERVAL_MS * (attempt + 1));
      continue;
    }

    try {
      await mkdir(lockDir);
      return true;
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (errorCode === 'EEXIST') {
        return false;
      }
      if (errorCode !== 'ENOENT' || attempt === BUILTIN_SKILLS_LOCK_ACQUIRE_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(BUILTIN_SKILLS_LOCK_WAIT_INTERVAL_MS * (attempt + 1));
    }
  }
  throw new Error('builtin_skills_lock_acquire_retry_exhausted');
}

async function waitForBuiltinSkillsSeed(
  lockDir: string,
  manifestPath: string,
  matcher: (manifest: BuiltinSkillManifest | null) => boolean,
): Promise<void> {
  const deadline = Date.now() + BUILTIN_SKILLS_LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (matcher(await readBuiltinSkillManifest(manifestPath))) {
      return;
    }
    if (!fs.existsSync(lockDir)) {
      return;
    }
    await sleep(BUILTIN_SKILLS_LOCK_WAIT_INTERVAL_MS);
  }
  throw new Error('builtin_skills_seed_wait_timeout');
}

function builtinSkillTargetsExist(targetDir: string, skills: string[], hasSharedRuntime: boolean): boolean {
  const targetPaths = skills.map((skill) => resolve(targetDir, skill));
  if (hasSharedRuntime) {
    targetPaths.push(resolve(targetDir, SHARED_RUNTIME_DIRNAME));
  }
  return targetPaths.every((targetPath) => fs.existsSync(targetPath));
}

function parseBooleanFlag(input: string | undefined, fallback: boolean): boolean {
  if (typeof input !== 'string') return fallback;
  const value = input.trim().toLowerCase();
  if (!value) return fallback;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

function isSafeSkillName(name: string): boolean {
  return /^\.?[a-zA-Z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

function parseSkillList(input: string | undefined): string[] {
  if (typeof input !== 'string') return [...DEFAULT_BUILTIN_SKILLS];
  if (!input.trim()) return [];
  const skills = input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => isSafeSkillName(item));
  if (skills.length === 0) return [];
  return Array.from(new Set(skills));
}

function resolveSkillsSourceDir(fileExists: (path: string) => boolean = fs.existsSync): string {
  const explicit = (process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR ?? '').trim();
  if (explicit) return explicit;
  if (fileExists(PACKAGED_IMAGE_SKILLS_DIR)) return PACKAGED_IMAGE_SKILLS_DIR;
  return FALLBACK_DEV_SKILLS_DIR;
}

async function mirrorDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(
      join(sourceDir, entry.name),
      join(targetDir, entry.name),
      { recursive: true, force: true },
    );
  }
}

async function rewriteAbsoluteSkillPaths(rootDir: string, skillDir: string): Promise<void> {
  const entries = await readFileList(skillDir);
  const fromBase = `/etc/codex/skills/${rootDir}`;
  const toBase = skillDir;
  for (const file of entries) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(fromBase)) continue;
    await writeFile(file, content.split(fromBase).join(toBase), 'utf8');
  }
}

async function readFileList(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await readFileList(fullPath));
      continue;
    }
    if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

export function resolveBuiltinSkillsConfig(): {
  sourceDir: string;
  required: boolean;
  skills: string[];
};
export function resolveBuiltinSkillsConfig(args?: {
  fileExists?: (path: string) => boolean;
}): {
  sourceDir: string;
  required: boolean;
  skills: string[];
} {
  const sourceDir = resolveSkillsSourceDir(args?.fileExists);
  const required = parseBooleanFlag(process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED, true);
  const skills = parseSkillList(process.env.MBOS_AGENT_BUILTIN_SKILLS);
  return { sourceDir, required, skills };
}

export async function inspectBuiltinSkills(args: {
  sourceDir: string;
  skills: string[];
  required: boolean;
}): Promise<{
  available: string[];
  missing: string[];
  sourceDir: string;
  skillContracts: Record<string, BuiltinSkillCapabilityContract>;
}> {
  const available: string[] = [];
  const missing: string[] = [];
  const skillContracts: Record<string, BuiltinSkillCapabilityContract> = {};
  for (const skill of args.skills) {
    const skillRoot = resolve(args.sourceDir, skill);
    const skillFile = resolve(skillRoot, 'SKILL.md');
    if (!fs.existsSync(skillRoot) || !fs.existsSync(skillFile)) {
      missing.push(skill);
      continue;
    }
    const contractPath = resolve(skillRoot, 'capabilities.json');
    if (!fs.existsSync(contractPath)) {
      throw new Error(`builtin_skill_contract_missing:${skill}`);
    }
    try {
      skillContracts[skill] = await readBuiltinSkillCapabilityContract(skillRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'skill_contract_invalid';
      throw new Error(`builtin_skill_contract_invalid:${skill}:${message}`);
    }
    available.push(skill);
  }
  if (args.required && missing.length > 0) {
    throw new Error(`builtin_skills_missing:${missing.join(',')}`);
  }
  return {
    available,
    missing,
    sourceDir: args.sourceDir,
    skillContracts,
  };
}

export async function seedBuiltinSkills(args: {
  sourceDir: string;
  skills: string[];
  targetDir: string;
  manifestDir: string;
}): Promise<{
  targetDir: string;
  seeded: string[];
  manifestPath: string;
}> {
  await mkdir(args.targetDir, { recursive: true });
  await mkdir(args.manifestDir, { recursive: true });
  const manifestPath = getBuiltinSkillManifestPath(args.manifestDir);
  const lockDir = join(args.manifestDir, BUILTIN_SKILLS_LOCK_DIRNAME);
  const hasSharedRuntime = fs.existsSync(resolve(args.sourceDir, SHARED_RUNTIME_DIRNAME));
  const matchesSeedRequest = (manifest: BuiltinSkillManifest | null) => manifestMatchesSeedRequest(
    manifest,
    args.sourceDir,
    args.skills,
    hasSharedRuntime,
  );

  while (true) {
    const manifest = await readBuiltinSkillManifest(manifestPath);
    if (matchesSeedRequest(manifest) && builtinSkillTargetsExist(args.targetDir, args.skills, hasSharedRuntime)) {
      return {
        targetDir: args.targetDir,
        seeded: [...args.skills],
        manifestPath,
      };
    }

    const hasLock = await acquireBuiltinSkillsLock(lockDir);
    if (!hasLock) {
      await waitForBuiltinSkillsSeed(lockDir, manifestPath, matchesSeedRequest);
      continue;
    }

    try {
      const lockedManifest = await readBuiltinSkillManifest(manifestPath);
      if (
        matchesSeedRequest(lockedManifest)
        && builtinSkillTargetsExist(args.targetDir, args.skills, hasSharedRuntime)
      ) {
        return {
          targetDir: args.targetDir,
          seeded: [...args.skills],
          manifestPath,
        };
      }

      const seeded: string[] = [];
      const skillContracts: Record<string, BuiltinSkillCapabilityContract> = {};
      for (const skill of args.skills) {
        const sourceSkillDir = resolve(args.sourceDir, skill);
        const targetSkillDir = resolve(args.targetDir, skill);
        await mirrorDirectory(sourceSkillDir, targetSkillDir);
        await rewriteAbsoluteSkillPaths(skill, targetSkillDir);
        skillContracts[skill] = await readBuiltinSkillCapabilityContract(sourceSkillDir);
        seeded.push(skill);
      }
      const runtimeHelpers: string[] = [];
      const sharedRuntimeSourceDir = resolve(args.sourceDir, SHARED_RUNTIME_DIRNAME);
      if (hasSharedRuntime) {
        const sharedRuntimeTargetDir = resolve(args.targetDir, SHARED_RUNTIME_DIRNAME);
        await mirrorDirectory(sharedRuntimeSourceDir, sharedRuntimeTargetDir);
        await rewriteAbsoluteSkillPaths(SHARED_RUNTIME_DIRNAME, sharedRuntimeTargetDir);
        runtimeHelpers.push(SHARED_RUNTIME_DIRNAME);
      }
      const nextManifest: BuiltinSkillManifest = {
        version: 2,
        source_dir: args.sourceDir,
        installed_skills: seeded,
        runtime_helpers: runtimeHelpers,
        skill_contracts: skillContracts,
        installed_at: new Date().toISOString(),
      };
      await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
      return {
        targetDir: args.targetDir,
        seeded,
        manifestPath,
      };
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }
}

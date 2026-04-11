import * as fs from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FALLBACK_DEV_SKILLS_DIR = resolve(MODULE_DIR, '../builtin-skills');
const PACKAGED_IMAGE_SKILLS_DIR = '/etc/codex/skills';
const DEFAULT_BUILTIN_SKILLS = ['mbos-context', 'feishu-docs', 'jira-ops'];
const MANIFEST_FILENAME = 'builtin-skills-manifest.json';

type BuiltinSkillManifest = {
  version: 1;
  source_dir: string;
  installed_skills: string[];
  installed_at: string;
};

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
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
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
}> {
  const available: string[] = [];
  const missing: string[] = [];
  for (const skill of args.skills) {
    const skillRoot = resolve(args.sourceDir, skill);
    const skillFile = resolve(skillRoot, 'SKILL.md');
    if (!fs.existsSync(skillRoot) || !fs.existsSync(skillFile)) {
      missing.push(skill);
      continue;
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
  const seeded: string[] = [];
  for (const skill of args.skills) {
    const sourceSkillDir = resolve(args.sourceDir, skill);
    const targetSkillDir = resolve(args.targetDir, skill);
    await mirrorDirectory(sourceSkillDir, targetSkillDir);
    await rewriteAbsoluteSkillPaths(skill, targetSkillDir);
    seeded.push(skill);
  }
  const manifestPath = join(args.manifestDir, MANIFEST_FILENAME);
  const manifest: BuiltinSkillManifest = {
    version: 1,
    source_dir: args.sourceDir,
    installed_skills: seeded,
    installed_at: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    targetDir: args.targetDir,
    seeded,
    manifestPath,
  };
}

import { copyFile, lstat, mkdir, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = resolve(MODULE_DIR, '../builtin-skills');
const DEFAULT_BUILTIN_SKILLS = ['.system', 'feishu-docs', 'jira-ops'];

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
  if (typeof input !== 'string' || !input.trim()) return [...DEFAULT_BUILTIN_SKILLS];
  const skills = input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => isSafeSkillName(item));
  if (skills.length === 0) return [...DEFAULT_BUILTIN_SKILLS];
  return Array.from(new Set(skills));
}

export function resolveBuiltinSkillsConfig(): {
  sourceDir: string;
  required: boolean;
  skills: string[];
} {
  const sourceDir = (process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR ?? DEFAULT_SKILLS_DIR).trim();
  const required = parseBooleanFlag(process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED, true);
  const skills = parseSkillList(process.env.MBOS_AGENT_BUILTIN_SKILLS);
  return { sourceDir, required, skills };
}

async function copyBuiltinSkillTree(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const stat = await lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await rm(targetPath, { recursive: true, force: true });
    }
  } catch {
    // target does not exist yet
  }
  const entries = await readdir(sourcePath, { withFileTypes: true });
  await mkdir(targetPath, { recursive: true });
  for (const entry of entries) {
    const childSourcePath = join(sourcePath, entry.name);
    const childTargetPath = join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyBuiltinSkillTree(childSourcePath, childTargetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (existsSync(childTargetPath)) continue;
    await mkdir(dirname(childTargetPath), { recursive: true });
    await copyFile(childSourcePath, childTargetPath);
  }
}

async function ensureBuiltinSkillSymlink(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    const stat = await lstat(targetPath);
    if (stat.isSymbolicLink()) {
      const existingTarget = await readlink(targetPath);
      if (resolve(dirname(targetPath), existingTarget) === resolve(sourcePath)) {
        return;
      }
    }
    await rm(targetPath, { recursive: true, force: true });
  } catch {
    // target missing
  }
  await symlink(sourcePath, targetPath, 'dir');
}

export async function syncBuiltinSkills(args: {
  cwd: string;
  sourceDir: string;
  skills: string[];
  required: boolean;
  strategy?: 'copy' | 'symlink';
  copyFileTree?: (sourcePath: string, targetPath: string) => Promise<void>;
  ensureSymlink?: (sourcePath: string, targetPath: string) => Promise<void>;
}): Promise<{
  mounted: string[];
  missing: string[];
  sourceDir: string;
}> {
  const mounted: string[] = [];
  const missing: string[] = [];
  const skillsRoot = join(args.cwd, '.codex', 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const copyFileTree = args.copyFileTree ?? copyBuiltinSkillTree;
  const ensureSymlink = args.ensureSymlink ?? ensureBuiltinSkillSymlink;
  const strategy = args.strategy ?? 'copy';
  for (const skill of args.skills) {
    const sourcePath = join(args.sourceDir, skill);
    if (!existsSync(sourcePath)) {
      missing.push(skill);
      continue;
    }
    const targetPath = join(skillsRoot, skill);
    if (strategy === 'symlink') {
      await ensureSymlink(sourcePath, targetPath);
    } else {
      await copyFileTree(sourcePath, targetPath);
    }
    mounted.push(skill);
  }
  if (strategy === 'copy') {
    await writeFile(
      join(skillsRoot, '.builtin-skills.json'),
      JSON.stringify(
        {
          source_dir: args.sourceDir,
          mounted_at: new Date().toISOString(),
          skills: mounted,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }
  if (args.required && missing.length > 0) {
    throw new Error(`builtin_skills_missing:${missing.join(',')}`);
  }
  return { mounted, missing, sourceDir: args.sourceDir };
}

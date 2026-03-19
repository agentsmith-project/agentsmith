import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = resolve(MODULE_DIR, '../builtin-skills');
const DEFAULT_BUILTIN_SKILLS = ['.system', 'feishu-docs', 'jira-ops', 'file-read'];

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

export async function syncBuiltinSkills(args: {
  cwd: string;
  sourceDir: string;
  skills: string[];
  required: boolean;
  copyFileTree?: (sourcePath: string, targetPath: string) => Promise<void>;
}): Promise<{
  mounted: string[];
  missing: string[];
  sourceDir: string;
}> {
  const mounted: string[] = [];
  const missing: string[] = [];
  const skillsRoot = join(args.cwd, '.codex', 'skills');
  const copyFileTree = args.copyFileTree ?? ((sourcePath: string, targetPath: string) => cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
  }));
  for (const skill of args.skills) {
    const sourcePath = join(args.sourceDir, skill);
    if (!existsSync(sourcePath)) {
      missing.push(skill);
      continue;
    }
    const targetPath = join(skillsRoot, skill);
    try {
      await copyFileTree(sourcePath, targetPath);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';
      // Internal agents reuse a persistent workspace. If builtin skills were
      // already synced by a previous run with different ownership, prefer the
      // existing copy over failing the whole request on overwrite.
      if ((code === 'EACCES' || code === 'EPERM') && existsSync(targetPath)) {
        mounted.push(skill);
        continue;
      }
      throw error;
    }
    mounted.push(skill);
  }
  if (args.required && missing.length > 0) {
    throw new Error(`builtin_skills_missing:${missing.join(',')}`);
  }
  return { mounted, missing, sourceDir: args.sourceDir };
}

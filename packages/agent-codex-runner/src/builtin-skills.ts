import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = '/etc/codex/skills';
const FALLBACK_DEV_SKILLS_DIR = resolve(MODULE_DIR, '../builtin-skills');
const DEFAULT_BUILTIN_SKILLS = ['feishu-docs', 'jira-ops'];

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

function resolveSkillsSourceDir(): string {
  const explicit = (process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR ?? '').trim();
  if (explicit) return explicit;
  if (existsSync(DEFAULT_SKILLS_DIR)) return DEFAULT_SKILLS_DIR;
  return FALLBACK_DEV_SKILLS_DIR;
}

export function resolveBuiltinSkillsConfig(): {
  sourceDir: string;
  required: boolean;
  skills: string[];
} {
  const sourceDir = resolveSkillsSourceDir();
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
    if (!existsSync(skillRoot) || !existsSync(skillFile)) {
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

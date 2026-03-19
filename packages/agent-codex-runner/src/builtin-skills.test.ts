import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBuiltinSkillsConfig, syncBuiltinSkills } from './builtin-skills.js';

describe('builtin-skills', () => {
  it('resolves defaults when env vars are not set', () => {
    const previousDir = process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    const previousRequired = process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    const previousSkills = process.env.MBOS_AGENT_BUILTIN_SKILLS;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
    try {
      const config = resolveBuiltinSkillsConfig();
      expect(config.sourceDir).toBe(resolve(process.cwd(), 'packages/agent-codex-runner/builtin-skills'));
      expect(config.required).toBe(true);
      expect(config.skills).toEqual(['.system', 'feishu-docs', 'jira-ops', 'file-read']);
    } finally {
      if (previousDir === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR = previousDir;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
    }
  });

  it('syncs builtin skills into task workspace .codex/skills', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const cwdRoot = mkdtempSync(join(tmpdir(), 'runner-skills-cwd-'));
    try {
      mkdirSync(join(sourceRoot, '.system'), { recursive: true });
      writeFileSync(join(sourceRoot, '.system', 'SKILL.md'), 'system');
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'feishu');
      const result = await syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['.system', 'feishu-docs'],
        required: true,
      });
      expect(result.mounted).toEqual(['.system', 'feishu-docs']);
      expect(result.missing).toEqual([]);
      expect(existsSync(join(cwdRoot, '.codex', 'skills', '.system', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(cwdRoot, '.codex', 'skills', 'feishu-docs', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });

  it('throws when required skills are missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const cwdRoot = mkdtempSync(join(tmpdir(), 'runner-skills-cwd-'));
    try {
      mkdirSync(join(sourceRoot, '.system'), { recursive: true });
      await expect(syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['.system', 'jira-ops'],
        required: true,
      })).rejects.toThrow('builtin_skills_missing:jira-ops');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });

  it('reuses existing mounted skill when overwrite is denied', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const cwdRoot = mkdtempSync(join(tmpdir(), 'runner-skills-cwd-'));
    try {
      mkdirSync(join(sourceRoot, '.system'), { recursive: true });
      writeFileSync(join(sourceRoot, '.system', 'SKILL.md'), 'new-system');

      const targetRoot = join(cwdRoot, '.codex', 'skills', '.system');
      mkdirSync(targetRoot, { recursive: true });
      writeFileSync(join(targetRoot, 'SKILL.md'), 'old-system');

      const result = await syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['.system'],
        required: true,
        copyFileTree: async (_source, target) => {
        if (String(target).includes('.codex/skills/.system')) {
          const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
          throw error;
        }
        },
      });

      expect(result.mounted).toEqual(['.system']);
      expect(result.missing).toEqual([]);
      expect(existsSync(join(targetRoot, 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });
});

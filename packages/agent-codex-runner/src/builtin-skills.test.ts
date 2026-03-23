import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
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
      expect(config.skills).toEqual(['.system', 'feishu-docs', 'jira-ops']);
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
      expect(existsSync(join(cwdRoot, '.codex', 'skills', '.builtin-skills.json'))).toBe(true);
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

  it('bootstraps shared skills once and preserves existing shared copies', async () => {
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
      });

      expect(result.mounted).toEqual(['.system']);
      expect(result.missing).toEqual([]);
      expect(existsSync(join(targetRoot, 'SKILL.md'))).toBe(true);
      expect(existsSync(join(cwdRoot, '.codex', 'skills', '.builtin-skills.json'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });

  it('uses symlink bootstrap for pre-mounted internal workspaces', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const cwdRoot = mkdtempSync(join(tmpdir(), 'runner-skills-cwd-'));
    try {
      mkdirSync(join(sourceRoot, 'custom-skill'), { recursive: true });
      writeFileSync(join(sourceRoot, 'custom-skill', 'SKILL.md'), 'custom-skill');

      const result = await syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['custom-skill'],
        required: true,
        strategy: 'symlink',
      });

      const targetPath = join(cwdRoot, '.codex', 'skills', 'custom-skill');
      expect(result.mounted).toEqual(['custom-skill']);
      expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
      expect(existsSync(join(cwdRoot, '.codex', 'skills', '.builtin-skills.json'))).toBe(false);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });

  it('replaces a stale symlink with a copied skill tree in copy mode', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const cwdRoot = mkdtempSync(join(tmpdir(), 'runner-skills-cwd-'));
    try {
      mkdirSync(join(sourceRoot, 'custom-skill'), { recursive: true });
      writeFileSync(join(sourceRoot, 'custom-skill', 'SKILL.md'), 'fresh-skill');

      mkdirSync(join(cwdRoot, '.codex', 'skills'), { recursive: true });
      const staleTarget = join(cwdRoot, '.codex', 'skills', 'custom-skill');
      writeFileSync(join(cwdRoot, 'stale.txt'), 'stale');
      await syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['custom-skill'],
        required: true,
        strategy: 'symlink',
      });

      const result = await syncBuiltinSkills({
        cwd: cwdRoot,
        sourceDir: sourceRoot,
        skills: ['custom-skill'],
        required: true,
        strategy: 'copy',
      });

      expect(result.mounted).toEqual(['custom-skill']);
      expect(lstatSync(staleTarget).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(staleTarget, 'SKILL.md'), 'utf-8')).toBe('fresh-skill');
      expect(existsSync(join(cwdRoot, '.codex', 'skills', '.builtin-skills.json'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(cwdRoot, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectBuiltinSkills, resolveBuiltinSkillsConfig } from './builtin-skills.js';

describe('builtin-skills', () => {
  it('resolves dev fallback defaults when env vars are not set', () => {
    const previousDir = process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    const previousRequired = process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    const previousSkills = process.env.MBOS_AGENT_BUILTIN_SKILLS;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
    try {
      const config = resolveBuiltinSkillsConfig();
      expect(config.sourceDir).toMatch(/(?:\/etc\/codex\/skills|packages\/agent-codex-runner\/builtin-skills)$/);
      expect(config.required).toBe(true);
      expect(config.skills).toEqual(['feishu-docs', 'jira-ops']);
    } finally {
      if (previousDir === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR = previousDir;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
    }
  });

  it('inspects builtin skills from a configured source dir', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'feishu');
      mkdirSync(join(sourceRoot, 'jira-ops'), { recursive: true });
      writeFileSync(join(sourceRoot, 'jira-ops', 'SKILL.md'), 'jira');
      const result = await inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs', 'jira-ops'],
        required: true,
      });
      expect(result.available).toEqual(['feishu-docs', 'jira-ops']);
      expect(result.missing).toEqual([]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('throws when required skills are missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'feishu');
      await expect(inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs', 'jira-ops'],
        required: true,
      })).rejects.toThrow('builtin_skills_missing:jira-ops');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('supports optional skill sets without failing when missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'jira-ops'), { recursive: true });
      writeFileSync(join(sourceRoot, 'jira-ops', 'SKILL.md'), 'jira');
      const result = await inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs', 'jira-ops'],
        required: false,
      });
      expect(result.available).toEqual(['jira-ops']);
      expect(result.missing).toEqual(['feishu-docs']);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

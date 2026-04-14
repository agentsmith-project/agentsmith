import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectBuiltinSkills, resolveBuiltinSkillsConfig, seedBuiltinSkills } from './builtin-skills.js';
import { parseBuiltinSkillCapabilityContract, readBuiltinSkillCapabilityContract } from './skill-capabilities.js';

const resolveBuiltinSkillsConfigWithArgs = resolveBuiltinSkillsConfig as unknown as (
  args?: {
    fileExists?: (path: string) => boolean;
  },
) => ReturnType<typeof resolveBuiltinSkillsConfig>;

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
      expect(config.sourceDir).toMatch(/packages\/notebook-codex-runner\/builtin-skills$/);
      expect(config.required).toBe(true);
      expect(config.skills).toEqual(['mbos-context', 'feishu-docs', 'jira-ops']);
    } finally {
      if (previousDir === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR = previousDir;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
    }
  });

  it('prefers packaged image builtin skills when /etc/codex/skills is present', () => {
    const previousDir = process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    const previousRequired = process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    const previousSkills = process.env.MBOS_AGENT_BUILTIN_SKILLS;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
    try {
      const config = resolveBuiltinSkillsConfigWithArgs({
        fileExists: (target: string) => target === '/etc/codex/skills',
      });
      expect(config.sourceDir).toBe('/etc/codex/skills');
      expect(config.required).toBe(true);
      expect(config.skills).toEqual(['mbos-context', 'feishu-docs', 'jira-ops']);
    } finally {
      if (previousDir === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR = previousDir;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
    }
  });

  it('treats an explicit empty skill list as no optional builtin skills', () => {
    const previousSkills = process.env.MBOS_AGENT_BUILTIN_SKILLS;
    const previousRequired = process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    delete process.env.MBOS_AGENT_BUILTIN_SKILLS_DIR;
    process.env.MBOS_AGENT_BUILTIN_SKILLS = '';
    process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = '0';
    try {
      const config = resolveBuiltinSkillsConfig();
      expect(config.required).toBe(false);
      expect(config.skills).toEqual([]);
    } finally {
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
    }
  });

  it('treats a sanitized-empty explicit skill list as empty instead of restoring defaults', () => {
    const previousSkills = process.env.MBOS_AGENT_BUILTIN_SKILLS;
    const previousRequired = process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
    process.env.MBOS_AGENT_BUILTIN_SKILLS = ', , ###';
    process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = '0';
    try {
      const config = resolveBuiltinSkillsConfig();
      expect(config.required).toBe(false);
      expect(config.skills).toEqual([]);
    } finally {
      if (previousSkills === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS = previousSkills;
      if (previousRequired === undefined) delete process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED;
      else process.env.MBOS_AGENT_BUILTIN_SKILLS_REQUIRED = previousRequired;
    }
  });

  it('inspects builtin skills from a configured source dir', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'feishu');
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'feishu-docs',
          dependencies: [
            {
              name: 'feishu-managed-user',
              kind: 'managed_credential',
              provider: 'feishu',
              scope: 'member',
              refresh_supported: true,
            },
          ],
        }),
      );
      mkdirSync(join(sourceRoot, 'jira-ops'), { recursive: true });
      writeFileSync(join(sourceRoot, 'jira-ops', 'SKILL.md'), 'jira');
      writeFileSync(
        join(sourceRoot, 'jira-ops', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'jira-ops',
          dependencies: [
            {
              name: 'jira-auth',
              kind: 'simple_credential_bundle',
              scopes: ['task', 'member'],
              fields: [
                { name: 'base_url', keys: ['credentials.jira_base_url', 'credentials.jira_url'], required: true },
                { name: 'token', keys: ['credentials.jira_token', 'credentials.jira_api_token'], required: true },
              ],
            },
          ],
        }),
      );
      const result = await inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs', 'jira-ops'],
        required: true,
      });
      expect(result.available).toEqual(['feishu-docs', 'jira-ops']);
      expect(result.missing).toEqual([]);
      expect(result.skillContracts['jira-ops']?.dependencies?.[0]).toMatchObject({
        name: 'jira-auth',
        kind: 'simple_credential_bundle',
      });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('throws when required skills are missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'feishu');
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'feishu-docs', dependencies: [] }),
      );
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
      writeFileSync(
        join(sourceRoot, 'jira-ops', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'jira-ops', dependencies: [] }),
      );
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

  it('seeds builtin skills into the task user directory and rewrites absolute /etc paths', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs'), { recursive: true });
      mkdirSync(join(sourceRoot, '.mbos-runtime'), { recursive: true });
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'SKILL.md'),
        'python3 /etc/codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list',
      );
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'feishu-docs',
          dependencies: [
            {
              name: 'feishu-managed-user',
              kind: 'managed_credential',
              provider: 'feishu',
              scope: 'member',
              refresh_supported: true,
            },
          ],
        }),
      );
      writeFileSync(join(sourceRoot, '.mbos-runtime', 'capability_runtime.py'), 'RUNTIME = True\n');
      const result = await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });
      expect(result.seeded).toEqual(['feishu-docs']);
      expect(readFileSync(join(targetRoot, 'feishu-docs', 'SKILL.md'), 'utf-8')).toContain(
        `${targetRoot}/feishu-docs/scripts/feishu_mcp.py`,
      );
      expect(readFileSync(join(targetRoot, '.mbos-runtime', 'capability_runtime.py'), 'utf-8')).toContain('RUNTIME');
      const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8')) as {
        installed_skills: string[];
        runtime_helpers?: string[];
        skill_contracts?: Record<string, { dependencies?: Array<{ name?: string }> }>;
      };
      expect(manifest.installed_skills).toEqual(['feishu-docs']);
      expect(manifest.runtime_helpers).toContain('.mbos-runtime');
      expect(manifest.skill_contracts?.['feishu-docs']?.dependencies?.[0]?.name).toBe('feishu-managed-user');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(manifestRoot, { recursive: true, force: true });
    }
  });

  it('fails inspection when a selected skill is missing its machine-readable capability contract', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'jira-ops'), { recursive: true });
      writeFileSync(join(sourceRoot, 'jira-ops', 'SKILL.md'), 'jira');
      await expect(inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['jira-ops'],
        required: true,
      })).rejects.toThrow('builtin_skill_contract_missing:jira-ops');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('allows concurrent builtin-skill seeding into the same task workspace without EEXIST races', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs', 'scripts'), { recursive: true });
      mkdirSync(join(sourceRoot, '.mbos-runtime', 'scripts'), { recursive: true });
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'SKILL.md'),
        'python3 /etc/codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list',
      );
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'feishu-docs', dependencies: [] }),
      );
      writeFileSync(join(sourceRoot, 'feishu-docs', 'scripts', 'feishu_mcp.py'), 'print("feishu")\n');
      writeFileSync(join(sourceRoot, '.mbos-runtime', 'scripts', 'capability_runtime.py'), 'RUNTIME = True\n');

      const results = await Promise.all(
        Array.from({ length: 12 }, () => seedBuiltinSkills({
          sourceDir: sourceRoot,
          skills: ['feishu-docs'],
          targetDir: targetRoot,
          manifestDir: manifestRoot,
        })),
      );

      expect(results).toHaveLength(12);
      for (const result of results) {
        expect(result.seeded).toEqual(['feishu-docs']);
        expect(result.manifestPath).toBe(join(manifestRoot, 'builtin-skills-manifest.json'));
      }
      expect(readFileSync(join(targetRoot, 'feishu-docs', 'SKILL.md'), 'utf8')).toContain(
        `${targetRoot}/feishu-docs/scripts/feishu_mcp.py`,
      );
      expect(readFileSync(join(targetRoot, '.mbos-runtime', 'scripts', 'capability_runtime.py'), 'utf8')).toContain(
        'RUNTIME = True',
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(manifestRoot, { recursive: true, force: true });
    }
  });

  it('keeps existing task-root state and skips replaying builtin-skill mirrors on repeated seeding', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    try {
      mkdirSync(join(sourceRoot, 'feishu-docs', 'scripts'), { recursive: true });
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'seeded-skill-v1');
      writeFileSync(
        join(sourceRoot, 'feishu-docs', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'feishu-docs', dependencies: [] }),
      );
      writeFileSync(join(sourceRoot, 'feishu-docs', 'scripts', 'seeded-tool.py'), 'print("v1")\n');

      await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });

      writeFileSync(join(targetRoot, 'feishu-docs', 'local-state.txt'), 'keep-me');
      writeFileSync(join(sourceRoot, 'feishu-docs', 'SKILL.md'), 'seeded-skill-v2');
      writeFileSync(join(sourceRoot, 'feishu-docs', 'scripts', 'new-tool.py'), 'print("v2")\n');

      await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['feishu-docs'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });

      expect(readFileSync(join(targetRoot, 'feishu-docs', 'local-state.txt'), 'utf8')).toBe('keep-me');
      expect(readFileSync(join(targetRoot, 'feishu-docs', 'SKILL.md'), 'utf8')).toBe('seeded-skill-v1');
      expect(existsSync(join(targetRoot, 'feishu-docs', 'scripts', 'new-tool.py'))).toBe(false);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(manifestRoot, { recursive: true, force: true });
    }
  });

  it('parses project_member as a first-class skill capability scope', () => {
    const contract = parseBuiltinSkillCapabilityContract({
      version: 1,
      skill_name: 'mbos-context',
      dependencies: [
        {
          name: 'project-personal-feishu',
          kind: 'managed_credential',
          provider: 'feishu',
          scope: 'project_member',
          refresh_supported: true,
        },
      ],
      provides: [
        {
          kind: 'context_store',
          scopes: ['member', 'task', 'project_member', 'project', 'workspace'],
          direct_access: true,
          writable_scopes: ['member', 'task'],
        },
      ],
    });

    expect(contract.dependencies[0]).toMatchObject({
      name: 'project-personal-feishu',
      scope: 'project_member',
    });
    expect(contract.provides?.[0]).toMatchObject({
      scopes: ['member', 'task', 'project_member', 'project', 'workspace'],
    });
  });

  it('ships mbos-context with project_member readable but not agent-writable', async () => {
    const config = resolveBuiltinSkillsConfigWithArgs({
      fileExists: (target: string) => target !== '/etc/codex/skills',
    });
    const contract = await readBuiltinSkillCapabilityContract(join(config.sourceDir, 'mbos-context'));
    expect(contract.provides?.[0]).toMatchObject({
      kind: 'context_store',
      scopes: ['member', 'task', 'project_member', 'project', 'workspace'],
      writable_scopes: ['member', 'task'],
    });
  });

  it('documents project_member as readable-only for agent execution in mbos-context skill docs', () => {
    const config = resolveBuiltinSkillsConfigWithArgs({
      fileExists: (target: string) => target !== '/etc/codex/skills',
    });
    const skillDoc = readFileSync(join(config.sourceDir, 'mbos-context', 'SKILL.md'), 'utf8');
    expect(skillDoc).toContain('read or write member/task');
    expect(skillDoc).toContain('read project_member');
    expect(skillDoc).not.toContain('write member/task/project_member');
  });
});

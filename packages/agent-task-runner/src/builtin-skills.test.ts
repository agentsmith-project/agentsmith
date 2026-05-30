import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
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
      expect(config.sourceDir).toMatch(/packages\/[^/]+\/builtin-skills$/);
      expect(config.required).toBe(true);
      expect(config.skills).toEqual(['mbos-context']);
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
      expect(config.skills).toEqual(['mbos-context']);
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
      mkdirSync(join(sourceRoot, 'sample-tool'), { recursive: true });
      writeFileSync(join(sourceRoot, 'sample-tool', 'SKILL.md'), 'sample skill');
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'sample-tool',
          dependencies: [
            {
              name: 'sample-runtime-dependency',
              kind: 'simple_credential_bundle',
              scopes: ['member'],
              fields: [
                { name: 'token', keys: ['credentials.sample_runtime_token'], required: true },
              ],
            },
          ],
        }),
      );
      mkdirSync(join(sourceRoot, 'optional-tool'), { recursive: true });
      writeFileSync(join(sourceRoot, 'optional-tool', 'SKILL.md'), 'optional skill');
      writeFileSync(
        join(sourceRoot, 'optional-tool', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'optional-tool',
          dependencies: [
            {
              name: 'sample-secret',
              kind: 'simple_credential_bundle',
              scopes: ['task', 'member'],
              fields: [
                { name: 'base_url', keys: ['credentials.sample_base_url', 'credentials.sample_url'], required: true },
                { name: 'token', keys: ['credentials.sample_token', 'credentials.sample_api_token'], required: true },
              ],
            },
          ],
        }),
      );
      const result = await inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool', 'optional-tool'],
        required: true,
      });
      expect(result.available).toEqual(['sample-tool', 'optional-tool']);
      expect(result.missing).toEqual([]);
      expect(result.skillContracts['optional-tool']?.dependencies?.[0]).toMatchObject({
        name: 'sample-secret',
        kind: 'simple_credential_bundle',
      });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('throws when required skills are missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'sample-tool'), { recursive: true });
      writeFileSync(join(sourceRoot, 'sample-tool', 'SKILL.md'), 'sample skill');
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'sample-tool', dependencies: [] }),
      );
      await expect(inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool', 'optional-tool'],
        required: true,
      })).rejects.toThrow('builtin_skills_missing:optional-tool');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('supports optional skill sets without failing when missing', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'optional-tool'), { recursive: true });
      writeFileSync(join(sourceRoot, 'optional-tool', 'SKILL.md'), 'optional skill');
      writeFileSync(
        join(sourceRoot, 'optional-tool', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'optional-tool', dependencies: [] }),
      );
      const result = await inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool', 'optional-tool'],
        required: false,
      });
      expect(result.available).toEqual(['optional-tool']);
      expect(result.missing).toEqual(['sample-tool']);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('seeds builtin skills into the task user directory and rewrites absolute /etc paths', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    try {
      mkdirSync(join(sourceRoot, 'sample-tool'), { recursive: true });
      mkdirSync(join(sourceRoot, '.mbos-runtime'), { recursive: true });
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'SKILL.md'),
        'python3 /etc/codex/skills/sample-tool/scripts/sample_tool.py tools-list',
      );
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({
          version: 1,
          skill_name: 'sample-tool',
          dependencies: [
            {
              name: 'sample-runtime-dependency',
              kind: 'simple_credential_bundle',
              scopes: ['member'],
              fields: [
                { name: 'token', keys: ['credentials.sample_runtime_token'], required: true },
              ],
            },
          ],
        }),
      );
      writeFileSync(join(sourceRoot, '.mbos-runtime', 'capability_runtime.py'), 'RUNTIME = True\n');
      const result = await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });
      expect(result.seeded).toEqual(['sample-tool']);
      expect(readFileSync(join(targetRoot, 'sample-tool', 'SKILL.md'), 'utf-8')).toContain(
        `${targetRoot}/sample-tool/scripts/sample_tool.py`,
      );
      expect(readFileSync(join(targetRoot, '.mbos-runtime', 'capability_runtime.py'), 'utf-8')).toContain('RUNTIME');
      const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8')) as {
        installed_skills: string[];
        runtime_helpers?: string[];
        skill_contracts?: Record<string, { dependencies?: Array<{ name?: string }> }>;
      };
      expect(manifest.installed_skills).toEqual(['sample-tool']);
      expect(manifest.runtime_helpers).toContain('.mbos-runtime');
      expect(manifest.skill_contracts?.['sample-tool']?.dependencies?.[0]?.name).toBe('sample-runtime-dependency');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(manifestRoot, { recursive: true, force: true });
    }
  });

  it('fails inspection when a selected skill is missing its machine-readable capability contract', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    try {
      mkdirSync(join(sourceRoot, 'optional-tool'), { recursive: true });
      writeFileSync(join(sourceRoot, 'optional-tool', 'SKILL.md'), 'optional skill');
      await expect(inspectBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['optional-tool'],
        required: true,
      })).rejects.toThrow('builtin_skill_contract_missing:optional-tool');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('allows concurrent builtin-skill seeding into the same task workspace without EEXIST races', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    try {
      mkdirSync(join(sourceRoot, 'sample-tool', 'scripts'), { recursive: true });
      mkdirSync(join(sourceRoot, '.mbos-runtime', 'scripts'), { recursive: true });
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'SKILL.md'),
        'python3 /etc/codex/skills/sample-tool/scripts/sample_tool.py tools-list',
      );
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'sample-tool', dependencies: [] }),
      );
      writeFileSync(join(sourceRoot, 'sample-tool', 'scripts', 'sample_tool.py'), 'print("sample")\n');
      writeFileSync(join(sourceRoot, '.mbos-runtime', 'scripts', 'capability_runtime.py'), 'RUNTIME = True\n');

      const results = await Promise.all(
        Array.from({ length: 12 }, () => seedBuiltinSkills({
          sourceDir: sourceRoot,
          skills: ['sample-tool'],
          targetDir: targetRoot,
          manifestDir: manifestRoot,
        })),
      );

      expect(results).toHaveLength(12);
      for (const result of results) {
        expect(result.seeded).toEqual(['sample-tool']);
        expect(result.manifestPath).toBe(join(manifestRoot, 'builtin-skills-manifest.json'));
      }
      expect(readFileSync(join(targetRoot, 'sample-tool', 'SKILL.md'), 'utf8')).toContain(
        `${targetRoot}/sample-tool/scripts/sample_tool.py`,
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

  it('retries when the builtin-skill lock parent is briefly unavailable', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'runner-skills-src-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'runner-skills-target-'));
    const manifestRoot = mkdtempSync(join(tmpdir(), 'runner-skills-manifest-'));
    const lockDir = join(manifestRoot, '.builtin-skills-seed.lock');
    let lockEnoentFailures = 0;
    const lockMkdirOptions: unknown[] = [];

    vi.resetModules();
    vi.doMock('node:fs/promises', () => {
      type Mkdir = typeof fsPromises.mkdir;
      const mkdirMock: Mkdir = (async (
        path: Parameters<Mkdir>[0],
        options?: Parameters<Mkdir>[1],
      ) => {
        if (String(path) === lockDir) {
          lockMkdirOptions.push(options);
          if (lockEnoentFailures === 0) {
            lockEnoentFailures += 1;
            const error = new Error('transient manifest parent not visible') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            throw error;
          }
        }
        return fsPromises.mkdir(path, options);
      }) as Mkdir;
      const mocked = {
        ...fsPromises,
        mkdir: mkdirMock,
      };
      return {
        ...mocked,
        default: mocked,
      };
    });

    try {
      mkdirSync(join(sourceRoot, 'sample-tool', 'scripts'), { recursive: true });
      writeFileSync(join(sourceRoot, 'sample-tool', 'SKILL.md'), 'sample skill');
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'sample-tool', dependencies: [] }),
      );
      writeFileSync(join(sourceRoot, 'sample-tool', 'scripts', 'sample_tool.py'), 'print("sample")\n');

      const { seedBuiltinSkills: seedBuiltinSkillsWithMockedFs } = await import('./builtin-skills.js');
      const result = await seedBuiltinSkillsWithMockedFs({
        sourceDir: sourceRoot,
        skills: ['sample-tool'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });

      expect(result.seeded).toEqual(['sample-tool']);
      expect(readFileSync(join(targetRoot, 'sample-tool', 'SKILL.md'), 'utf8')).toBe('sample skill');
      expect(lockEnoentFailures).toBe(1);
      expect(lockMkdirOptions).toEqual([undefined, undefined]);
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
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
      mkdirSync(join(sourceRoot, 'sample-tool', 'scripts'), { recursive: true });
      writeFileSync(join(sourceRoot, 'sample-tool', 'SKILL.md'), 'seeded-skill-v1');
      writeFileSync(
        join(sourceRoot, 'sample-tool', 'capabilities.json'),
        JSON.stringify({ version: 1, skill_name: 'sample-tool', dependencies: [] }),
      );
      writeFileSync(join(sourceRoot, 'sample-tool', 'scripts', 'seeded-tool.py'), 'print("v1")\n');

      await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });

      writeFileSync(join(targetRoot, 'sample-tool', 'local-state.txt'), 'keep-me');
      writeFileSync(join(sourceRoot, 'sample-tool', 'SKILL.md'), 'seeded-skill-v2');
      writeFileSync(join(sourceRoot, 'sample-tool', 'scripts', 'new-tool.py'), 'print("v2")\n');

      await seedBuiltinSkills({
        sourceDir: sourceRoot,
        skills: ['sample-tool'],
        targetDir: targetRoot,
        manifestDir: manifestRoot,
      });

      expect(readFileSync(join(targetRoot, 'sample-tool', 'local-state.txt'), 'utf8')).toBe('keep-me');
      expect(readFileSync(join(targetRoot, 'sample-tool', 'SKILL.md'), 'utf8')).toBe('seeded-skill-v1');
      expect(existsSync(join(targetRoot, 'sample-tool', 'scripts', 'new-tool.py'))).toBe(false);
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
          name: 'project-personal-sample',
          kind: 'simple_credential_bundle',
          scopes: ['project_member'],
          fields: [
            { name: 'token', keys: ['credentials.project_personal_token'], required: true },
          ],
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
      name: 'project-personal-sample',
      kind: 'simple_credential_bundle',
      scopes: ['project_member'],
    });
    expect(contract.provides?.[0]).toMatchObject({
      scopes: ['member', 'task', 'project_member', 'project', 'workspace'],
    });
  });

  it('rejects retired managed credential skill dependencies', () => {
    expect(() => parseBuiltinSkillCapabilityContract({
      version: 1,
      skill_name: 'sample-tool',
      dependencies: [
        {
          name: 'retired-provider-dependency',
          kind: 'managed_credential',
          provider: 'sample-provider',
          scope: 'member',
          refresh_supported: true,
        },
      ],
    })).toThrow('skill_contract_invalid:dependencies[0]');
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

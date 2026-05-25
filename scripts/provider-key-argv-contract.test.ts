import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const TARGET_SCRIPTS = [
  'scripts/lib/bootstrap-common.sh',
  'scripts/agent-runner-init-resources.sh',
] as const;

function shellLogicalCommands(source: string): string[] {
  const commands: string[] = [];
  let current = '';

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    current = current ? `${current}\n${line}` : line;
    if (line.endsWith('\\')) {
      continue;
    }
    commands.push(current);
    current = '';
  }

  if (current) {
    commands.push(current);
  }

  return commands;
}

describe('provider key argv contract', () => {
  it.each(TARGET_SCRIPTS)('%s keeps preset provider keys out of node and curl argv', async (relativePath) => {
    const source = await readFile(path.resolve(process.cwd(), relativePath), 'utf-8');
    const keyCommands = shellLogicalCommands(source).filter((command) =>
      command.includes('PRESET_ENDPOINT_API_KEY'),
    );

    expect(keyCommands.length).toBeGreaterThan(0);
    for (const command of keyCommands) {
      expect(command, `${relativePath} must not pass PRESET_ENDPOINT_API_KEY to node argv`).not.toMatch(
        /(?:^|[\s$(])(?:docker_compose\s+exec\s+-T\s+api\s+)?node\b/u,
      );
      expect(command, `${relativePath} must not pass PRESET_ENDPOINT_API_KEY to curl argv`).not.toMatch(
        /(?:^|[\s$(])(?:curl|api_curl)\b/u,
      );
    }

    expect(source).not.toMatch(/value\s*:\s*process\.argv\[/u);
    expect(source).toContain('chmod 600 "${file}"');
    expect(source).toContain('--data-binary @"${credential_body_file}"');
    expect(source).toContain('process.stdin.on("data"');
  });
});

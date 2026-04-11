import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { describe, expect, it } from 'vitest';

function runBash(script: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

async function listenOnRandomPort(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('expected a tcp address');
  }

  return { server, port: address.port };
}

describe('port-utils helper', () => {
  it('reports an actively-listening port as busy and non-bindable', async () => {
    const { server, port } = await listenOnRandomPort();

    try {
      const output = runBash(`
        source "${process.cwd()}/scripts/lib/port-utils.sh"
        if port_is_listening "${port}"; then
          printf 'listening=yes\\n'
        else
          printf 'listening=no\\n'
        fi
        if port_is_bindable "${port}"; then
          printf 'bindable=yes\\n'
        else
          printf 'bindable=no\\n'
        fi
      `);

      expect(output).toContain('listening=yes');
      expect(output).toContain('bindable=no');
    } finally {
      server.close();
    }
  });

  it('picks a fallback port when the preferred port is already bound', async () => {
    const { server, port } = await listenOnRandomPort();

    try {
      const output = runBash(`
        source "${process.cwd()}/scripts/lib/port-utils.sh"
        fallback="$(port_pick_free "${port}" "${port}" "$(( ${port} + 5 ))")"
        printf 'fallback=%s\\n' "\${fallback}"
      `);

      expect(output).toMatch(/^fallback=\d+$/);
      expect(output).not.toBe(`fallback=${port}`);
    } finally {
      server.close();
    }
  });
});

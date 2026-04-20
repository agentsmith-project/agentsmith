import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('demo deploy prepare script', () => {
  it('derives the allowed control-plane node name from the current cluster name', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'demo-deploy', 'prepare.sh');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).not.toContain('"agentsmith-control-plane"');
    expect(script).toContain('kind_control_plane_node_name_from_context_or_override');
  });
});

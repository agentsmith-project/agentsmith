import { describe, expect, it } from 'vitest';
import { sanitizeK8sName } from './internal-agent-workspace-provisioner.js';

describe('sanitizeK8sName', () => {
  it('does not leave a trailing dash after truncation', () => {
    expect(
      sanitizeK8sName(
        'juicefs-pv-feishu-demo-workspace-proj-1773965427268-85257-flib-52deaa10bf04',
        'fallback',
      ),
    ).toBe('juicefs-pv-feishu-demo-workspace-proj-1773965427268-85257-flib');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveReleaseStoryAdminMode } from '../e2e/integration-release-user-story.helpers';

describe('resolveReleaseStoryAdminMode', () => {
  it('falls back to email_pending when directory search is not supported', () => {
    expect(
      resolveReleaseStoryAdminMode({
        idp_ok: true,
        directory_search_supported: false,
        advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
      }),
    ).toBe('email_pending');
  });

  it('uses directory_user when directory search is supported', () => {
    expect(
      resolveReleaseStoryAdminMode({
        idp_ok: true,
        directory_search_supported: true,
      }),
    ).toBe('directory_user');
  });
});

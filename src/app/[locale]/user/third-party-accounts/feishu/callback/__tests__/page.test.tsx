import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

const mockCompleteFeishuOAuth = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useSearchParams: () => new URLSearchParams('code=test_code&state=test_state'),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const dict: Record<string, string> = {
      feishu_callback_title: 'Completing Feishu Connection',
      feishu_callback_description: 'Please wait while we complete Feishu token exchange.',
      feishu_callback_success: 'Feishu account connected. Redirecting back to Third-Party Accounts...',
      back_to_accounts: 'Back to Third-Party Accounts',
    };
    return dict[key] ?? key;
  },
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  UserExternalConnectionsAPI: vi.fn().mockImplementation(function () {
    return {
      completeFeishuOAuth: mockCompleteFeishuOAuth,
    };
  }),
}));

import FeishuCallbackPage from '../page';

describe('FeishuCallbackPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCompleteFeishuOAuth.mockResolvedValue({ id: 'uec_1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes feishu oauth and redirects back to accounts', async () => {
    render(<FeishuCallbackPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCompleteFeishuOAuth).toHaveBeenCalledWith({
        code: 'test_code',
        state: 'test_state',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(screen.getByText('Feishu account connected. Redirecting back to Third-Party Accounts...')).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/en-US/user/third-party-accounts?provider=feishu&connected=1');
  });
});

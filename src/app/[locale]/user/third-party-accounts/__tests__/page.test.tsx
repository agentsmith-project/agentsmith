import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserExternalConnection } from '@/lib/api';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  UserExternalConnectionsAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      create: mockCreate,
      update: mockUpdate,
      remove: mockRemove,
    };
  }),
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/public-runtime-config', () => ({
  getPublicRuntimeConfig: vi.fn(() => ({
    useMsw: true,
    mswStrictReady: true,
  })),
}));

import ThirdPartyAccountsPage from '../page';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ThirdPartyAccountsPage', () => {
  const user = userEvent.setup();
  const wrapper = createWrapper();

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'uec_1' });
    mockUpdate.mockResolvedValue({ id: 'uec_1' });
    mockRemove.mockResolvedValue(undefined);
  });

  it('renders personal connections as a quiet settings sheet without dashboard-style chrome', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('third-party-accounts__create-btn')).toBeInTheDocument();
    });

    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('description')).toBeInTheDocument();
    expect(screen.getByText('personal_scope_note')).toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__capability-note')).toHaveTextContent('agent_capability_note');
    expect(screen.getByRole('button', { name: 'create_personal_connection' })).toBeInTheDocument();
    expect(screen.queryByTestId('third-party-accounts__summary-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__list-section')).toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__list-section').className).not.toMatch(/rounded-lg|shadow-card/);
    expect(screen.queryByTestId('third-party-accounts__personal-scope')).not.toBeInTheDocument();
    expect(screen.queryByTestId('third-party-accounts__workspace-scope')).not.toBeInTheDocument();
  });

  it('opens a right-side sheet without extra explanatory panels', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__create-btn'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__sheet')).toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__sheet').className).toMatch(/sm:w-\[640px\]/);
    expect(screen.queryByTestId('third-party-accounts__provider-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('third-party-accounts__submit-btn')).toBeInTheDocument();
    expect(screen.getByText('create_title')).toBeInTheDocument();
    expect(screen.queryByText('personal_scope_badge')).not.toBeInTheDocument();
    expect(screen.queryByText('personal_scope_dialog_note')).not.toBeInTheDocument();
  });

  it('creates a custom secret bundle with generic fields', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__create-btn'));

    await user.type(screen.getByLabelText('display_name_label'), 'Issue Tracker Bundle');
    await user.type(screen.getByLabelText('custom_domain_label'), 'issues.internal.example');
    await user.type(screen.getByLabelText('note_label'), 'Used for team issue sync');
    await user.click(screen.getByTestId('third-party-accounts__field-secret-0'));
    await user.type(screen.getByTestId('third-party-accounts__field-key-0'), 'base_url');
    await user.type(screen.getByTestId('third-party-accounts__field-value-0'), 'https://issues.internal.example');
    await user.type(screen.getByTestId('third-party-accounts__field-description-0'), 'Base URL');
    await user.click(screen.getByTestId('third-party-accounts__add-field'));
    await user.type(screen.getByTestId('third-party-accounts__field-key-1'), 'token');
    await user.type(screen.getByTestId('third-party-accounts__field-value-1'), 'secret-token');
    await user.type(screen.getByTestId('third-party-accounts__field-description-1'), 'API token');

    await user.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        provider: 'custom',
        kind: 'secret_bundle',
        custom_domain: 'issues.internal.example',
        display_name: 'Issue Tracker Bundle',
        note: 'Used for team issue sync',
        status: 'active',
        fields: [
          { key: 'base_url', value: 'https://issues.internal.example', description: 'Base URL', secret: false },
          { key: 'token', value: 'secret-token', description: 'API token', secret: true },
        ],
      });
    });
  });

  it('keeps the create form custom-only without provider templates', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__create-btn'));

    expect(screen.queryByTestId('third-party-accounts__provider-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('third-party-accounts__kind-select')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('provider_label')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('kind_label')).not.toBeInTheDocument();
  });

  it('preserves existing secret on edit when secret input is left blank', async () => {
    mockList.mockResolvedValue([
      {
        id: 'uec_existing',
        user_id: 'user_1',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Tool Token',
        custom_domain: 'tools.internal.example',
        note: null,
        status: 'active',
        fields: [
          { key: 'base_url', description: 'Base URL', secret: false, masked_value: 'https://tools.internal.example' },
          { key: 'token', description: 'API token', secret: true, masked_value: 'to••••en' },
        ],
        last_used_at: null,
        last_error: null,
        created_at: '2026-03-05T00:00:00Z',
        updated_at: '2026-03-05T00:00:00Z',
      },
    ]);

    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__row-uec_existing'));
    await user.clear(screen.getByLabelText('display_name_label'));
    await user.type(screen.getByLabelText('display_name_label'), 'Tool Token Updated');

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'uec_existing',
        {
          custom_domain: 'tools.internal.example',
          display_name: 'Tool Token Updated',
          note: null,
          status: 'active',
          fields: [
            { key: 'base_url', value: 'https://tools.internal.example', description: 'Base URL', secret: false },
            { key: 'token', value: '', description: 'API token', secret: true },
          ],
        },
      );
    });
  });

  it('preserves custom provider generic field values when editing existing connections', async () => {
    mockList.mockResolvedValue([
      {
        id: 'uec_custom',
        user_id: 'user_1',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Custom Integration',
        custom_domain: 'custom.example.com',
        note: 'External system connection',
        status: 'active',
        fields: [
          { key: 'base_url', description: 'Base URL', secret: false, masked_value: 'https://api.custom.example.com' },
          { key: 'token', description: 'API token', secret: true, masked_value: 'tok••••redacted' },
        ],
        last_used_at: null,
        last_error: null,
        created_at: '2026-03-05T00:00:00Z',
        updated_at: '2026-03-05T00:00:00Z',
      },
    ]);

    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__row-uec_custom'));

    expect(screen.getByLabelText('display_name_label')).toHaveValue('Custom Integration');
    expect(screen.getByLabelText('custom_domain_label')).toHaveValue('custom.example.com');
    const fieldKeys = screen.getAllByPlaceholderText('field_key_placeholder');
    const fieldValues = screen.getAllByPlaceholderText('field_value_placeholder');
    expect(fieldKeys[0]).toHaveValue('base_url');
    expect(fieldValues[0]).toHaveValue('https://api.custom.example.com');
    expect(screen.getByPlaceholderText('secret_keep_existing_hint')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'uec_custom',
        expect.objectContaining({
          custom_domain: 'custom.example.com',
          display_name: 'Custom Integration',
          note: 'External system connection',
          fields: [
            { key: 'base_url', value: 'https://api.custom.example.com', description: 'Base URL', secret: false },
            { key: 'token', value: '', description: 'API token', secret: true },
          ],
        }),
      );
    });
  });

  it('refetches the connections list on remount so newly seeded visual rows can surface', async () => {
    mockList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'uec_visual_custom_integration',
          user_id: 'user_1',
          provider: 'custom',
          kind: 'secret_bundle',
          display_name: 'Visual Custom Integration',
          custom_domain: 'api.visual.example.com',
          note: 'Visual seed',
          status: 'active',
          fields: [
            {
              key: 'base_url',
              description: 'Base URL',
              secret: false,
              masked_value: 'https://api.visual.example.com',
            },
          ],
          last_used_at: null,
          last_error: null,
          created_at: '2026-03-05T00:00:00Z',
          updated_at: '2026-03-05T00:00:00Z',
        },
      ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['me', 'external-connections'], []);
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { unmount } = render(<ThirdPartyAccountsPage />, { wrapper: localWrapper });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    unmount();
    render(<ThirdPartyAccountsPage />, { wrapper: localWrapper });

    await waitFor(() => {
      expect(screen.getByTestId('third-party-accounts__row-uec_visual_custom_integration')).toBeInTheDocument();
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('waits for service worker controller takeover before issuing the initial list fetch', async () => {
    const controllerChangeListeners = new Set<() => void>();
    const addEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'controllerchange') {
        controllerChangeListeners.add(handler);
      }
    });
    const removeEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'controllerchange') {
        controllerChangeListeners.delete(handler);
      }
    });
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    mockList.mockResolvedValue([
      {
        id: 'uec_visual_custom_integration',
        user_id: 'user_1',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Visual Custom Integration',
        custom_domain: 'api.visual.example.com',
        note: 'Visual seed',
        status: 'active',
        fields: [
          {
            key: 'base_url',
            description: 'Base URL',
            secret: false,
            masked_value: 'https://api.visual.example.com',
          },
        ],
        last_used_at: null,
        last_error: null,
        created_at: '2026-03-05T00:00:00Z',
        updated_at: '2026-03-05T00:00:00Z',
      },
    ]);

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          ready,
          controller: null,
          addEventListener,
          removeEventListener,
        },
      },
    });

    try {
      render(<ThirdPartyAccountsPage />, { wrapper });

      expect(mockList).not.toHaveBeenCalled();

      resolveReady!();
      await waitFor(() => {
        expect(addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
      });
      expect(mockList).not.toHaveBeenCalled();
      expect(controllerChangeListeners.size).toBe(1);

      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
          serviceWorker: {
            ready,
            controller: {},
            addEventListener,
            removeEventListener,
          },
        },
      });
      await act(async () => {
        controllerChangeListeners.forEach((handler) => handler());
      });

      await waitFor(() => {
        expect(mockList).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByTestId('third-party-accounts__row-uec_visual_custom_integration')).toBeInTheDocument();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('prefers visual seed data so the seeded edit-sheet row can render even before the list refetch settles', async () => {
    const seededConnection: UserExternalConnection = {
      id: 'uec_visual_custom_integration',
      user_id: 'user_1',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Custom Integration',
      custom_domain: 'api.visual.example.com',
      note: 'Visual seed',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          description: 'Base URL',
          secret: false,
          masked_value: 'https://api.visual.example.com',
        },
      ],
      last_used_at: null,
      last_error: null,
      created_at: '2026-03-05T00:00:00Z',
      updated_at: '2026-03-05T00:00:00Z',
    };
    mockList.mockResolvedValue([]);
    const originalVisualSeed = (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
    const originalVisualContext = window.__MBOS_VISUAL_E2E_CONTEXT__;
    window.__MBOS_VISUAL_E2E_CONTEXT__ = { thirdPartyAccountsBootstrap: true };
    (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [seededConnection];

    try {
      render(<ThirdPartyAccountsPage />, { wrapper });

      expect(await screen.findByTestId('third-party-accounts__row-uec_visual_custom_integration')).toBeInTheDocument();
    } finally {
      window.__MBOS_VISUAL_E2E_CONTEXT__ = originalVisualContext;
      (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = originalVisualSeed;
    }
  });

  it('hydrates the first frame from sessionStorage visual seed and clears the bootstrap key after consumption', async () => {
    const seededConnection: UserExternalConnection = {
      id: 'uec_visual_custom_integration',
      user_id: 'user_1',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Custom Integration',
      custom_domain: 'api.visual.example.com',
      note: 'Visual seed',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          description: 'Base URL',
          secret: false,
          masked_value: 'https://api.visual.example.com',
        },
      ],
      last_used_at: null,
      last_error: null,
      created_at: '2026-03-05T00:00:00Z',
      updated_at: '2026-03-05T00:00:00Z',
    };
    mockList.mockImplementation(() => new Promise(() => {}));
    const originalVisualSeed = (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
    const originalVisualContext = window.__MBOS_VISUAL_E2E_CONTEXT__;
    window.__MBOS_VISUAL_E2E_CONTEXT__ = { thirdPartyAccountsBootstrap: true };
    window.sessionStorage.setItem('__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__', JSON.stringify([seededConnection]));
    const removeItem = vi.spyOn(window.sessionStorage, 'removeItem');
    (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [seededConnection];
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    try {
      render(<ThirdPartyAccountsPage />, { wrapper: localWrapper });

      expect(await screen.findByTestId('third-party-accounts__row-uec_visual_custom_integration')).toBeInTheDocument();
      expect(mockList).toHaveBeenCalledTimes(1);
      expect(window.__MBOS_VISUAL_E2E_CONTEXT__).toBeUndefined();
    } finally {
      window.__MBOS_VISUAL_E2E_CONTEXT__ = originalVisualContext;
      (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = originalVisualSeed;
      removeItem.mockRestore();
    }
  });

  it('ignores stale visual bootstrap data when the visual opt-in marker is missing', async () => {
    const seededConnection: UserExternalConnection = {
      id: 'uec_visual_custom_integration',
      user_id: 'user_1',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Custom Integration',
      custom_domain: 'api.visual.example.com',
      note: 'Visual seed',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          description: 'Base URL',
          secret: false,
          masked_value: 'https://api.visual.example.com',
        },
      ],
      last_used_at: null,
      last_error: null,
      created_at: '2026-03-05T00:00:00Z',
      updated_at: '2026-03-05T00:00:00Z',
    };
    mockList.mockResolvedValue([]);
    const originalVisualSeed = (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
    const originalVisualContext = window.__MBOS_VISUAL_E2E_CONTEXT__;
    window.sessionStorage.setItem('__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__', JSON.stringify([seededConnection]));
    (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [seededConnection];
    delete window.__MBOS_VISUAL_E2E_CONTEXT__;

    try {
      render(<ThirdPartyAccountsPage />, { wrapper });

      await waitFor(() => {
        expect(mockList).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByTestId('third-party-accounts__row-uec_visual_custom_integration')).not.toBeInTheDocument();
    } finally {
      window.__MBOS_VISUAL_E2E_CONTEXT__ = originalVisualContext;
      (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = originalVisualSeed;
      window.sessionStorage.removeItem('__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__');
    }
  });

  it('falls back to store truth after deleting a visually seeded connection', async () => {
    const seededConnection: UserExternalConnection = {
      id: 'uec_visual_custom_integration',
      user_id: 'user_1',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Custom Integration',
      custom_domain: 'api.visual.example.com',
      note: 'Visual seed',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          description: 'Base URL',
          secret: false,
          masked_value: 'https://api.visual.example.com',
        },
      ],
      last_used_at: null,
      last_error: null,
      created_at: '2026-03-05T00:00:00Z',
      updated_at: '2026-03-05T00:00:00Z',
    };
    mockList
      .mockResolvedValueOnce([seededConnection])
      .mockResolvedValueOnce([]);
    const originalVisualSeed = (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
    const originalVisualContext = window.__MBOS_VISUAL_E2E_CONTEXT__;
    window.__MBOS_VISUAL_E2E_CONTEXT__ = { thirdPartyAccountsBootstrap: true };
    (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [seededConnection];

    try {
      render(<ThirdPartyAccountsPage />, { wrapper });

      await screen.findByTestId('third-party-accounts__row-uec_visual_custom_integration');
      await user.click(screen.getByTestId('third-party-accounts__delete-uec_visual_custom_integration'));
      await user.click(screen.getByRole('button', { name: 'delete' }));

      await waitFor(() => {
        expect(screen.queryByTestId('third-party-accounts__row-uec_visual_custom_integration')).not.toBeInTheDocument();
      });
      expect(mockRemove).toHaveBeenCalledWith('uec_visual_custom_integration');
      expect(mockList).toHaveBeenCalledTimes(2);
    } finally {
      window.__MBOS_VISUAL_E2E_CONTEXT__ = originalVisualContext;
      (globalThis.window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = originalVisualSeed;
    }
  });
});

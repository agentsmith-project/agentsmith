import { act, renderHook } from '@testing-library/react';

import { useChatLayoutMode } from '../use-chat-layout-mode';

describe('useChatLayoutMode', () => {
  const originalMatchMedia = window.matchMedia;
  const originalLocalStorage = window.localStorage;

  function installMatchMedia(initialMatches: boolean) {
    let matches = initialMatches;
    let listener: (() => void) | null = null;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      media: '(min-width: 1920px)',
      onchange: null,
      addEventListener: (_event: string, cb: () => void) => {
        listener = cb;
      },
      removeEventListener: () => {
        listener = null;
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    return {
      update(next: boolean) {
        matches = next;
        listener?.();
      },
    };
  }

  function setLocalStorage(getItemValue: string | null) {
    const getItem = vi.fn(() => getItemValue);
    const setItem = vi.fn();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem,
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      } as Storage,
    });
    return { getItem, setItem };
  }

  beforeEach(() => {
    setLocalStorage(null);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
    vi.restoreAllMocks();
  });

  it('returns standard layout and hides toggle for non-ultrawide viewport', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useChatLayoutMode());

    expect(result.current.layoutMode).toBe('standard');
    expect(result.current.showLayoutToggle).toBe(false);
  });

  it('reads persisted layout mode when ultrawide viewport is available', () => {
    const { getItem } = setLocalStorage('ultrawide');
    installMatchMedia(true);

    const { result } = renderHook(() => useChatLayoutMode());

    expect(getItem).toHaveBeenCalledWith('mbos.chat.layout.mode');
    expect(result.current.showLayoutToggle).toBe(true);
    expect(result.current.layoutMode).toBe('ultrawide');
  });

  it('persists toggled mode and reacts to viewport changes', () => {
    const { setItem } = setLocalStorage(null);
    const media = installMatchMedia(true);

    const { result } = renderHook(() => useChatLayoutMode());

    act(() => {
      result.current.onToggleLayoutMode();
    });
    expect(result.current.layoutMode).toBe('ultrawide');
    expect(setItem).toHaveBeenCalledWith('mbos.chat.layout.mode', 'ultrawide');

    act(() => {
      media.update(false);
    });
    expect(result.current.showLayoutToggle).toBe(false);
    expect(result.current.layoutMode).toBe('standard');
  });
});

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const CHAT_LAYOUT_MODE_STORAGE_KEY = 'mbos.chat.layout.mode';
const ULTRAWIDE_MIN_WIDTH = 1920;

export interface UseChatLayoutModeResult {
  layoutMode: 'standard' | 'ultrawide';
  showLayoutToggle: boolean;
  onToggleLayoutMode: () => void;
}

export function useChatLayoutMode(): UseChatLayoutModeResult {
  const [preferredLayoutMode, setPreferredLayoutMode] = useState<'standard' | 'ultrawide'>('standard');
  const [isUltrawideViewport, setIsUltrawideViewport] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.localStorage?.getItem !== 'function') return;
    const saved = window.localStorage.getItem(CHAT_LAYOUT_MODE_STORAGE_KEY);
    if (saved === 'standard' || saved === 'ultrawide') {
      setPreferredLayoutMode(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(`(min-width: ${ULTRAWIDE_MIN_WIDTH}px)`);
    const sync = () => setIsUltrawideViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const showLayoutToggle = isUltrawideViewport;
  const layoutMode = useMemo<'standard' | 'ultrawide'>(
    () => (showLayoutToggle ? preferredLayoutMode : 'standard'),
    [preferredLayoutMode, showLayoutToggle],
  );

  const onToggleLayoutMode = useCallback(() => {
    setPreferredLayoutMode((prev) => {
      const next = prev === 'standard' ? 'ultrawide' : 'standard';
      if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
        window.localStorage.setItem(CHAT_LAYOUT_MODE_STORAGE_KEY, next);
      }
      return next;
    });
  }, []);

  return { layoutMode, showLayoutToggle, onToggleLayoutMode };
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const SOURCES_LAYOUT_MODE_STORAGE_KEY = 'mbos.sources.layout.mode';
const ULTRAWIDE_MIN_WIDTH = 1920;

export type SourcesLayoutMode = 'standard' | 'ultrawide';

export interface UseSourcesLayoutModeResult {
  layoutMode: SourcesLayoutMode;
  showLayoutToggle: boolean;
  onToggleLayoutMode: () => void;
}

export function useSourcesLayoutMode(): UseSourcesLayoutModeResult {
  const [preferredLayoutMode, setPreferredLayoutMode] = useState<SourcesLayoutMode>('standard');
  const [isUltrawideViewport, setIsUltrawideViewport] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return;
    try {
      const saved = storage.getItem(SOURCES_LAYOUT_MODE_STORAGE_KEY);
      if (saved === 'standard' || saved === 'ultrawide') {
        setPreferredLayoutMode(saved);
      }
    } catch {
      // Ignore storage access errors in restricted/test environments.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(`(min-width: ${ULTRAWIDE_MIN_WIDTH}px)`);
    const sync = () => setIsUltrawideViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const showLayoutToggle = isUltrawideViewport;
  const layoutMode = useMemo<SourcesLayoutMode>(
    () => (showLayoutToggle ? preferredLayoutMode : 'standard'),
    [preferredLayoutMode, showLayoutToggle],
  );

  const onToggleLayoutMode = useCallback(() => {
    setPreferredLayoutMode((prev) => {
      const next: SourcesLayoutMode = prev === 'standard' ? 'ultrawide' : 'standard';
      if (typeof window !== 'undefined') {
        const storage = window.localStorage;
        if (storage && typeof storage.setItem === 'function') {
          try {
            storage.setItem(SOURCES_LAYOUT_MODE_STORAGE_KEY, next);
          } catch {
            // Ignore storage access errors in restricted/test environments.
          }
        }
      }
      return next;
    });
  }, []);

  return { layoutMode, showLayoutToggle, onToggleLayoutMode };
}

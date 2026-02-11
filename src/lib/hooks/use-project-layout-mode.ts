'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const PROJECT_LAYOUT_MODE_STORAGE_KEY = 'mbos.project.layout.mode';
export const PROJECT_LAYOUT_MODE_EVENT = 'mbos:project-layout-mode-change';
const ULTRAWIDE_MIN_WIDTH = 1920;

export type ProjectLayoutMode = 'standard' | 'ultrawide';

export interface UseProjectLayoutModeResult {
  layoutMode: ProjectLayoutMode;
  showLayoutToggle: boolean;
  onToggleLayoutMode: () => void;
}

function isProjectLayoutMode(value: unknown): value is ProjectLayoutMode {
  return value === 'standard' || value === 'ultrawide';
}

export function broadcastProjectLayoutMode(layoutMode: ProjectLayoutMode): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(PROJECT_LAYOUT_MODE_STORAGE_KEY, layoutMode);
    }
  } catch {
    // Ignore storage access errors in restricted/test environments.
  }
  try {
    window.dispatchEvent(new CustomEvent(PROJECT_LAYOUT_MODE_EVENT, { detail: { layoutMode } }));
  } catch {
    // Ignore custom event errors in restricted/test environments.
  }
}

export function useProjectLayoutMode(): UseProjectLayoutModeResult {
  const [preferredLayoutMode, setPreferredLayoutMode] = useState<ProjectLayoutMode>('standard');
  const [isUltrawideViewport, setIsUltrawideViewport] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromStorage = () => {
      try {
        const storage = window.localStorage;
        if (!storage || typeof storage.getItem !== 'function') return;
        const saved = storage.getItem(PROJECT_LAYOUT_MODE_STORAGE_KEY);
        if (saved === 'standard' || saved === 'ultrawide') {
          setPreferredLayoutMode(saved);
        }
      } catch {
        // Ignore storage access errors in restricted/test environments.
      }
    };

    syncFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== PROJECT_LAYOUT_MODE_STORAGE_KEY) return;
      syncFromStorage();
    };
    const onBroadcast = (event: Event) => {
      const customEvent = event as CustomEvent<{ layoutMode?: unknown }>;
      const nextLayoutMode = customEvent?.detail?.layoutMode;
      if (isProjectLayoutMode(nextLayoutMode)) {
        setPreferredLayoutMode(nextLayoutMode);
        return;
      }
      syncFromStorage();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(PROJECT_LAYOUT_MODE_EVENT, onBroadcast as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PROJECT_LAYOUT_MODE_EVENT, onBroadcast as EventListener);
    };
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
  const layoutMode = useMemo<ProjectLayoutMode>(
    () => (showLayoutToggle ? preferredLayoutMode : 'standard'),
    [preferredLayoutMode, showLayoutToggle],
  );

  const onToggleLayoutMode = useCallback(() => {
    setPreferredLayoutMode((prev) => {
      const next: ProjectLayoutMode = prev === 'standard' ? 'ultrawide' : 'standard';
      broadcastProjectLayoutMode(next);
      return next;
    });
  }, []);

  return { layoutMode, showLayoutToggle, onToggleLayoutMode };
}

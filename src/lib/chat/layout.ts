export type ChatLayoutMode = 'standard' | 'ultrawide';

export function getChatContentWidthClass(layoutMode: ChatLayoutMode): string {
  // Standard mode aligns with other modules' comfortable reading width.
  // Ultrawide mode intentionally expands, but still caps line length.
  return layoutMode === 'ultrawide' ? 'max-w-[1920px]' : 'max-w-[980px]';
}


'use client';

import { cn } from '@/lib/utils';

interface EditableSessionTitleProps {
  draftTitle: string;
  editing: boolean;
  layoutMode: 'standard' | 'ultrawide';
  placeholderTitle: string;
  renameTitle: string;
  sessionTitle: string;
  statusText: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
  onStartEditing: () => void;
}

export function EditableSessionTitle({
  draftTitle,
  editing,
  layoutMode,
  placeholderTitle,
  renameTitle,
  sessionTitle,
  statusText,
  onCancel,
  onChange,
  onCommit,
  onStartEditing,
}: EditableSessionTitleProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {editing ? (
        <input
          value={draftTitle}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          onBlur={onCommit}
          autoFocus
          className={cn(
            'w-full bg-transparent text-sm text-foreground',
            layoutMode === 'ultrawide' ? 'max-w-[980px]' : 'max-w-[640px]',
            'border border-subtle rounded-sm px-2 py-1',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          )}
        />
      ) : sessionTitle ? (
        <button
          type="button"
          onClick={onStartEditing}
          className={cn(
            'text-sm font-medium text-foreground truncate',
            'hover:text-foreground/90 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm px-1 -mx-1',
          )}
          title={renameTitle}
        >
          {sessionTitle}
        </button>
      ) : (
        <div className="text-sm font-medium text-foreground truncate">{placeholderTitle}</div>
      )}

      {statusText ? (
        <span className="text-xs text-tertiary" data-testid="chat__stream-status">{statusText}</span>
      ) : null}
    </div>
  );
}

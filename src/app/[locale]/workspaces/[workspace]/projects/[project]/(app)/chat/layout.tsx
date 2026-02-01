import { ReactNode } from 'react';
import { SourcesPanel } from '@/components/app-shell/SourcesPanel';
import { ContextPanel } from '@/components/app-shell/ContextPanel';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <aside
        className="w-60 border-r border-border-subtle bg-surface flex-shrink-0"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <SourcesPanel />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {children}
      </main>

      <aside
        className="w-[300px] border-l border-border bg-surface flex-shrink-0"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <ContextPanel />
      </aside>
    </div>
  );
}

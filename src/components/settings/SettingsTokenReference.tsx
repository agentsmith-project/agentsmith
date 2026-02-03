'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface TokenItem {
  path: string;
  default?: string;
  description?: string;
}

export interface SettingsTokenReferenceProps {
  tokens: TokenItem[];
  title?: string;
  defaultOpen?: boolean;
}

export function SettingsTokenReference({
  tokens,
  title,
  defaultOpen = false,
}: SettingsTokenReferenceProps) {
  const settingsT = useTranslations('settings');
  const [open, setOpen] = React.useState(defaultOpen);

  if (tokens.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-surface-high/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-tertiary hover:text-primary transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>{title ?? settingsT('token_reference_title')}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <ul className="space-y-1.5 text-xs font-mono">
            {tokens.map((t) => (
              <li key={t.path} className="flex flex-col gap-0.5">
                <code className="text-primary break-all">{t.path}</code>
                {(t.default != null || t.description) && (
                  <span className="text-tertiary text-[11px] font-sans pl-1">
                    {t.default != null && (
                      <span>default: {t.default}</span>
                    )}
                    {t.default != null && t.description && ' · '}
                    {t.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

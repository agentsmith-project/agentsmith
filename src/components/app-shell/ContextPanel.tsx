'use client';

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem } from '@/components/ui/dropdown-menu';
import { useState } from 'react';

function ParameterSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-foreground-secondary">{label}</label>
        <span className="text-xs font-mono text-foreground">{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-surface-high rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'var(--color-accent)' }}
      />
    </div>
  );
}

export function ContextPanel() {
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [selectedModel, setSelectedModel] = useState('gpt-4');

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Context</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-3">
            Model
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full px-3 py-2 rounded bg-surface-high border border-border text-sm text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              {selectedModel}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-surface border border-border rounded-md w-full">
              <MenuItem onClick={() => setSelectedModel('gpt-4')}>gpt-4</MenuItem>
              <MenuItem onClick={() => setSelectedModel('gpt-3.5-turbo')}>gpt-3.5-turbo</MenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <section>
          <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-3">
            Parameters
          </h3>
          <div className="space-y-4">
            <ParameterSlider label="Temperature" value={temperature} onChange={setTemperature} />
            <ParameterSlider label="Max Tokens" value={maxTokens / 4096} onChange={(v) => setMaxTokens(Math.round(v * 4096))} />
          </div>
        </section>
      </div>
    </div>
  );
}

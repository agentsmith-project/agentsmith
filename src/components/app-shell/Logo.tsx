import * as React from 'react';
import { Sparkles } from 'lucide-react';

interface LogoProps {
  className?: string;
}

export function Logo({ className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-high border border-subtle">
        <Sparkles className="w-4 h-4 text-accent" strokeWidth={2} />
      </div>
      <span className="text-lg font-semibold text-foreground">MBOS</span>
    </div>
  );
}

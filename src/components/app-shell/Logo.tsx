import * as React from 'react';
import { Sparkles } from 'lucide-react';

interface LogoProps {
  className?: string;
}

export function Logo({ className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        data-testid="logo__mark"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border/45 bg-transparent"
      >
        <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.85} />
      </div>
      <span className="type-title text-foreground">MBOS</span>
    </div>
  );
}

import * as React from 'react';

interface LogoProps {
  className?: string;
}

export function Logo({ className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundImage: 'var(--ai-gradient)' }}
      >
        <span className="text-lg font-bold text-white">M</span>
      </div>
      <span className="text-lg font-semibold text-foreground">MBOS</span>
    </div>
  );
}

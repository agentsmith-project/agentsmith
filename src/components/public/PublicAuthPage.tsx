import * as React from 'react';
import { PublicThemeToggle } from '@/components/theme/PublicThemeToggle';
import { cn } from '@/lib/utils';

type PublicAuthFrameProps = {
  children: React.ReactNode;
  width?: 'narrow' | 'wide';
  className?: string;
};

export function PublicAuthFrame({
  children,
  width = 'wide',
  className,
}: PublicAuthFrameProps) {
  return (
    <div className={cn('relative min-h-screen bg-background px-4 py-6 md:px-6 md:py-8', className)}>
      <PublicThemeToggle className="absolute right-4 top-4 z-10 md:right-6 md:top-6" />
      <div
        className={cn(
          'mx-auto flex min-h-[calc(100vh-3rem)] items-center justify-center',
          width === 'wide' ? 'max-w-5xl' : 'max-w-xl',
        )}
      >
        {children}
      </div>
    </div>
  );
}

type PublicAuthShellProps = {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
};

export function PublicAuthShell({ children, aside, className }: PublicAuthShellProps) {
  return (
    <section
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border/60 bg-background/96 shadow-card',
        aside ? 'grid gap-0 md:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]' : '',
        className,
      )}
    >
      <div className="p-6 md:p-8">{children}</div>
      {aside ? (
        <aside className="border-t border-border/50 bg-surface-low/70 p-6 md:border-l md:border-t-0 md:p-8">
          {aside}
        </aside>
      ) : null}
    </section>
  );
}

export function PublicAuthHeader({
  badge,
  title,
  description,
  logo,
  className,
}: {
  badge?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  logo?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {logo ? <div className="flex justify-start">{logo}</div> : null}
      {badge ? <div>{badge}</div> : null}
      <div className="space-y-2.5">
        <h1 className="type-section-heading max-w-2xl text-balance text-foreground">{title}</h1>
        {description ? <p className="type-body-ui max-w-2xl text-secondary">{description}</p> : null}
      </div>
    </div>
  );
}

export function PublicAuthEyebrow({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'accent' | 'success';
}) {
  const toneClassName =
    tone === 'success'
      ? 'border-success/18 bg-success/8 text-success'
      : tone === 'accent'
        ? 'border-accent/18 bg-accent/8 text-accent'
        : 'border-border/60 bg-surface-low text-secondary';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em]',
        toneClassName,
      )}
    >
      {children}
    </div>
  );
}

export function PublicAuthSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border/55 bg-surface-low/72 p-5', className)}>
      {children}
    </div>
  );
}

export function PublicAuthMutedCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border border-border/45 bg-background/72 p-4', className)}>
      {children}
    </div>
  );
}

export function PublicAuthAsideBlock({
  title,
  description,
  children,
  icon,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border/55 bg-background/82 text-icon-default">
          {icon}
        </div>
      ) : null}
      {title || description ? (
        <div className="space-y-2">
          {title ? <h2 className="type-title text-foreground">{title}</h2> : null}
          {description ? <p className="type-body-ui text-secondary">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

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
        'w-full',
        aside ? 'grid gap-8 md:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)] md:items-start md:gap-10' : '',
        className,
      )}
    >
      <div className="px-1 py-6 md:px-0 md:py-8">{children}</div>
      {aside ? (
        <aside className="border-t border-border/45 px-1 pt-6 md:border-l md:border-t-0 md:pl-10 md:pr-0 md:pt-8">
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
      ? 'text-success'
      : tone === 'accent'
        ? 'text-accent'
        : 'text-secondary';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em]',
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
    <div className={cn('border-t border-subtle pt-5', className)}>
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
    <div className={cn('border-l border-subtle pl-3', className)}>
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
        <div className="flex h-8 w-8 items-center justify-center text-icon-default">
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

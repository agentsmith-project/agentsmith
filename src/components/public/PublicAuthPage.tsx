import * as React from 'react';
import { PublicThemeToggle } from '@/components/theme/PublicThemeToggle';
import { cn } from '@/lib/utils';

export type PublicAuthRecipe = 'public_auth_single' | 'public_auth_split';

const PUBLIC_AUTH_RECIPE_CONFIG: Record<
  PublicAuthRecipe,
  {
    width: 'narrow' | 'wide';
    layout: 'single' | 'split';
  }
> = {
  public_auth_single: {
    width: 'narrow',
    layout: 'single',
  },
  public_auth_split: {
    width: 'wide',
    layout: 'split',
  },
};

type PublicAuthFrameProps = {
  children: React.ReactNode;
  width?: 'narrow' | 'wide';
  recipe?: PublicAuthRecipe;
  className?: string;
};

export function PublicAuthFrame({
  children,
  width = 'wide',
  recipe,
  className,
}: PublicAuthFrameProps) {
  const resolvedWidth = recipe ? PUBLIC_AUTH_RECIPE_CONFIG[recipe].width : width;

  return (
    <div
      className={cn('relative min-h-screen bg-background px-4 py-6 md:px-6 md:py-8', className)}
      data-testid="public-auth__frame"
      data-width={resolvedWidth}
      data-recipe={recipe}
    >
      <PublicThemeToggle className="absolute right-4 top-4 z-10 md:right-6 md:top-6" />
      <div
        className={cn(
          'mx-auto flex min-h-[calc(100vh-3rem)] items-start justify-start pt-10 md:pt-14',
          resolvedWidth === 'wide' ? 'max-w-4xl' : 'max-w-[34rem]',
        )}
        data-testid="public-auth__stage"
      >
        {children}
      </div>
    </div>
  );
}

type PublicAuthShellProps = {
  children: React.ReactNode;
  aside?: React.ReactNode;
  recipe?: PublicAuthRecipe;
  className?: string;
};

export function PublicAuthShell({ children, aside, recipe, className }: PublicAuthShellProps) {
  const resolvedLayout = recipe ? PUBLIC_AUTH_RECIPE_CONFIG[recipe].layout : aside ? 'split' : 'single';
  const resolvedAside = resolvedLayout === 'split' ? aside : null;

  return (
    <section
      className={cn(
        'w-full max-w-[42rem]',
        resolvedLayout === 'split'
          ? 'grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.78fr)] md:items-start md:gap-8'
          : '',
        className,
      )}
      data-family="public-auth"
      data-layout={resolvedLayout}
      data-recipe={recipe}
      data-testid="public-auth__shell"
    >
      <div className="px-1 py-6 md:px-0 md:py-8">{children}</div>
      {resolvedAside ? (
        <aside className="px-1 pt-4 md:pl-6 md:pr-0 md:pt-8" data-testid="public-auth__aside">
          {resolvedAside}
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
        <h1 className="type-subheading max-w-xl text-balance text-foreground">{title}</h1>
        {description ? <p className="type-body-ui max-w-xl text-secondary">{description}</p> : null}
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
    <div className={cn('border-t border-subtle/70 pt-4', className)}>
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
    <div className={cn('space-y-0.5', className)}>
      {children}
    </div>
  );
}

export function PublicAuthSupportBlock({
  eyebrow,
  title,
  description,
  children,
  className,
  testId,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn('space-y-3', className)}
      data-surface="public-auth-support"
      data-testid={testId}
    >
      {eyebrow ? <p className="type-caption text-tertiary">{eyebrow}</p> : null}
      {title || description ? (
        <div className="space-y-1.5">
          {title ? <p className="type-title text-foreground">{title}</p> : null}
          {description ? <p className="type-body-ui text-secondary">{description}</p> : null}
        </div>
      ) : null}
      {children ? <div className="space-y-3">{children}</div> : null}
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

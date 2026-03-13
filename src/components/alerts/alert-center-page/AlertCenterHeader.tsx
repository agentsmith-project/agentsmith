'use client';

interface AlertCenterHeaderProps {
  embedded: boolean;
  t: (key: string) => string;
}

export function AlertCenterHeader({ embedded, t }: AlertCenterHeaderProps) {
  if (embedded) return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-tertiary">{t('subtitle')}</p>
      </div>
    </div>
  );
}

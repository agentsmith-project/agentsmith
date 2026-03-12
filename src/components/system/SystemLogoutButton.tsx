'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SystemLogoutButton() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogout = async () => {
    setIsSubmitting(true);
    try {
      await fetch('/api/system/session', { method: 'DELETE' });
      router.replace(`/${locale}/system/login`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Button type="button" variant="outline" onClick={handleLogout} disabled={isSubmitting} data-testid="system__logout">
      {t('logout')}
    </Button>
  );
}

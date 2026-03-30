'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SystemLogoutButton() {
  const router = useRouter();
  const t = useTranslations('system');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogout = async () => {
    setIsSubmitting(true);
    try {
      await fetch('/api/system/session', { method: 'DELETE' });
      router.replace('/system/login');
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

import { redirect } from 'next/navigation';
import { defaultLocale } from '@/lib/i18n/config';

export default function SystemLoginRedirectPage() {
  redirect(`/${defaultLocale}/system/login`);
}

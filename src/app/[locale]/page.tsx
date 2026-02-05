import { type Metadata } from 'next';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: _locale } = await params;
  return {
    title: 'MBOS - Login',
  };
}

export default async function LocalePage({ params }: Props) {
  const { locale } = await params;
  // Redirect to login page
  redirect(`/${locale}/login`);
}

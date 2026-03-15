import { redirect } from 'next/navigation';

interface LoginPageProps {
  params: Promise<{ locale: string }>;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;
  redirect(`/${locale}/login/workspace`);
}

import { setRequestLocale } from 'next-intl/server';
import { LoginPage } from '@/pages/login';

const Page = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginPage />;
};

export default Page;

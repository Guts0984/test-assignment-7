import { setRequestLocale } from 'next-intl/server';
import { CatalogPage } from '@/pages/catalog';

const Page = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CatalogPage />;
};

export default Page;

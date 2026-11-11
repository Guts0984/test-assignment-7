import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CatalogPage } from '@/views/catalog';

const Page = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  setRequestLocale(locale);
  // The table reads sort/filters from the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <CatalogPage />
    </Suspense>
  );
};

export default Page;

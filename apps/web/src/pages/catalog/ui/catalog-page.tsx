'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useMe } from '@/entities/session';
import { useRouter } from '@/shared/i18n/navigation';

export const CatalogPage = () => {
  const t = useTranslations('catalog');
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.data === null) router.replace('/login');
  }, [me.data, router]);

  if (!me.data) return null;
  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
    </main>
  );
};

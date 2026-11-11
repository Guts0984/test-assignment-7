import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import enMessages from '@/shared/i18n/messages/en.json';
import ukMessages from '@/shared/i18n/messages/uk.json';

const messagesByLocale = { en: enMessages, uk: ukMessages } as const;

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });

export const renderWithProviders = (
  ui: ReactElement,
  {
    locale = 'en',
    client = createTestQueryClient(),
    ...opts
  }: { locale?: 'en' | 'uk'; client?: QueryClient } & Omit<RenderOptions, 'wrapper'> = {},
) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]} timeZone="UTC">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...opts }) };
};

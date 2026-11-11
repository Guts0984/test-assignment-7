import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Decorator, Preview } from '@storybook/react-vite';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import enMessages from '@/shared/i18n/messages/en.json';
import ukMessages from '@/shared/i18n/messages/uk.json';

const messages = { en: enMessages, uk: ukMessages } as const;

const Providers = ({ locale, children }: { locale: 'en' | 'uk'; children: ReactNode }) => {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      <QueryClientProvider client={client}>
        <div className="bg-background p-4 text-foreground">{children}</div>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
};

const withProviders: Decorator = (Story, ctx) => {
  const locale = (ctx.globals.locale === 'uk' ? 'uk' : 'en') as 'en' | 'uk';
  if (typeof document !== 'undefined')
    document.documentElement.classList.toggle('dark', ctx.globals.theme === 'dark');
  return (
    <Providers locale={locale}>
      <Story />
    </Providers>
  );
};

/** Shared by the Storybook UI (preview.tsx) and by the Vitest runner that executes the stories' play functions. */
export const annotations: Preview = {
  decorators: [withProviders],
  globalTypes: {
    locale: {
      description: 'Language',
      toolbar: { icon: 'globe', items: ['en', 'uk'], dynamicTitle: true },
    },
    theme: {
      description: 'Theme',
      toolbar: { icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { locale: 'en', theme: 'light' },
  parameters: { layout: 'padded', a11y: { test: 'error' } },
};

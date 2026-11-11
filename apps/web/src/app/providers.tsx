'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/shared/api/query-client';

export const Providers = ({ children }: { children: ReactNode }) => {
  const [client] = useState(createQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
};

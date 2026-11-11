import type { ReactNode } from 'react';

// The real <html> lives in [locale]/layout.tsx (it needs the locale).
const RootLayout = ({ children }: { children: ReactNode }) => children;
export default RootLayout;

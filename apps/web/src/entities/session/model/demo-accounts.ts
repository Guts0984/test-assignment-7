export type DemoAccount = { login: 'admin' | 'editor1' | 'editor2' | 'viewer'; password: string };

/**
 * Accounts shown on the login page of a demo. The values come from the same SEED_* variables that
 * create the users (see next.config.ts), so the hint can never disagree with the seed. Turn it off with
 * SHOW_DEMO_LOGINS=false - a real deployment must not print passwords on its login page.
 */
export const getDemoAccounts = (): DemoAccount[] => {
  if (process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'false') return [];
  const all: DemoAccount[] = [
    { login: 'admin', password: process.env.NEXT_PUBLIC_DEMO_PW_ADMIN ?? '' },
    { login: 'editor1', password: process.env.NEXT_PUBLIC_DEMO_PW_EDITOR1 ?? '' },
    { login: 'editor2', password: process.env.NEXT_PUBLIC_DEMO_PW_EDITOR2 ?? '' },
    { login: 'viewer', password: process.env.NEXT_PUBLIC_DEMO_PW_VIEWER ?? '' },
  ];
  return all.filter((a) => a.password !== '');
};

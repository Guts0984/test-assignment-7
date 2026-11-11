import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../lib/cn';

export const Input = ({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50',
      className,
    )}
    {...rest}
  />
);

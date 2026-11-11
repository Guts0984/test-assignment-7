import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-background hover:bg-accent',
        ghost: 'hover:bg-accent',
        danger: 'bg-danger text-background hover:opacity-90',
      },
      size: { sm: 'h-8 px-3', md: 'h-9 px-4', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; ref?: Ref<HTMLButtonElement> };

export const Button = ({ className, variant, size, asChild, ref, ...rest }: Props) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
};

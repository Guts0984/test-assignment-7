'use client';

import * as D from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => (
  <D.Title className={cn('text-lg font-semibold', className)} {...p} />
);
export const DialogDescription = ({ className, ...p }: ComponentProps<typeof D.Description>) => (
  <D.Description className={cn('text-sm text-muted-foreground', className)} {...p} />
);

export const DialogContent = ({
  className,
  children,
  ...props
}: ComponentProps<typeof D.Content>) => (
  <D.Portal>
    <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
    <D.Content
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-lg border border-border bg-popover p-5 text-foreground shadow-lg',
        className,
      )}
      {...props}
    >
      {children}
    </D.Content>
  </D.Portal>
);

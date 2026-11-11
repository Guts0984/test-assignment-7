'use client';

import * as P from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export const PopoverContent = ({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof P.Content>) => (
  <P.Portal>
    <P.Content
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-border bg-popover p-3 text-sm text-foreground shadow-md',
        className,
      )}
      {...props}
    />
  </P.Portal>
);

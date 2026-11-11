'use client';

import type { ReactNode } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

export type AnchorRect = { left: number; top: number; width: number; height: number };

/** A popover attached to an arbitrary on-screen rectangle (e.g. the active grid cell). */
export const AnchoredPopover = ({
  rect,
  open,
  onOpenChange,
  label,
  children,
  className,
}: {
  rect: AnchorRect | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <Popover open={open && rect !== null} onOpenChange={onOpenChange}>
    <PopoverAnchor asChild>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          ...(rect ?? { left: 0, top: 0, width: 0, height: 0 }),
        }}
      />
    </PopoverAnchor>
    <PopoverContent aria-label={label} className={className ?? 'w-96'}>
      {children}
    </PopoverContent>
  </Popover>
);

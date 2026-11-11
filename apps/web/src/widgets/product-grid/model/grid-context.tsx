'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createGridStore, type GridActions, type GridState, type GridStore } from './grid-store';

const Ctx = createContext<GridStore | null>(null);

export const GridStoreProvider = ({
  store,
  children,
}: {
  store?: GridStore;
  children: ReactNode;
}) => {
  const [instance] = useState(() => store ?? createGridStore());
  return <Ctx.Provider value={instance}>{children}</Ctx.Provider>;
};

export const useGridStoreApi = (): GridStore => {
  const s = useContext(Ctx);
  if (!s) throw new Error('GridStoreProvider is missing');
  return s;
};

/** Subscribe to a slice; the component re-renders only when the selected value changes. */
export const useGrid = <T,>(selector: (s: GridState & GridActions) => T): T =>
  useStore(useGridStoreApi(), selector);

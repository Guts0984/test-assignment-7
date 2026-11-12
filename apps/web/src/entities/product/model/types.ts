import type { ChangeSource, EditableField } from '@catalog/shared';

export type CellEdit = { id: string; field: EditableField; value: unknown };

export type ConflictInfo = {
  mine: unknown;
  theirs: unknown;
  theirsVersion: number;
  author: string | null;
};

export const cellKey = (id: string, field: EditableField): string => `${id}:${field}`;

/** Sources a browser edit can have (bulk jobs, restore and revert are server-side actions). */
export type EditSource = Exclude<ChangeSource, 'bulk' | 'restore' | 'revert'>;

/** `overwriteConflicts`: the edit may replace a cell that has an unresolved conflict (only a deliberately typed value). */
export type CommitOptions = { overwriteConflicts?: boolean };

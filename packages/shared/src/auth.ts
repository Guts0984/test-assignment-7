import { z } from 'zod';

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({
  // No control characters (NUL etc.): they are never valid in a login and PostgreSQL refuses them.
  login: z
    .string()
    .min(1)
    .max(64)
    // eslint-disable-next-line no-control-regex -- intentionally matching control chars to reject them
    .regex(/^[^\u0000-\u001f\u007f]+$/, 'control characters are not allowed'),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  login: z.string(),
  role: roleSchema,
  /** For editors: the categories they may edit. Admin: all. Viewer: none. */
  categories: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;

/** Single source of truth for "may this user change a product in this category". */
export const canEditCategory = (
  me: Pick<Me, 'role' | 'categories'>,
  category: string | null,
): boolean => {
  if (me.role === 'admin') return true;
  if (me.role === 'viewer') return false;
  return category !== null && me.categories.includes(category);
};

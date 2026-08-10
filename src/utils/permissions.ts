import type { User } from '../types';

/**
 * Client-side mirror of `canSeeCosts` in `src/server/auth.ts`.
 *
 * This decides what the screens *draw*. It is not the control — the server
 * blanks the same fields on the way out, so a user without the permission gets
 * nulls from the API whatever the browser does. This exists so they are shown a
 * form without a price calculator rather than a price calculator full of empty
 * boxes.
 *
 * The two must agree on the rule, and the rule is: absent means denied. Every
 * other permission in this application reads an absent key as granted, which is
 * right for flags that predate the stored accounts and wrong for a new one
 * guarding money.
 */
export function canSeeCosts(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  return user.permissions?.costs === true;
}

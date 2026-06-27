/**
 * Single source of truth for admin role check.
 * ONLY returns true when role is EXACTLY the string "admin".
 * No fallbacks, no truthy checks, no undefined/null bypass.
 */
export function isAdmin(user) {
  return user?.role === 'admin';
}
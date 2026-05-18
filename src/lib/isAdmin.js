/**
 * Single source of truth for admin role check.
 * ONLY returns true when role is EXACTLY the string "admin".
 * No fallbacks, no truthy checks, no undefined/null bypass.
 */
export function isAdmin(user) {
  const result = user?.role === 'admin';
  console.log('[isAdmin] email:', user?.email, '| role:', user?.role, '| isAdmin:', result);
  return result;
}
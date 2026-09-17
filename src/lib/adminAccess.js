import { isAdmin } from './isAdmin.js';

/**
 * Resolve client-side admin access only after authentication has completed.
 *
 * A cached user object is not sufficient: AuthContext deliberately retains the
 * last user during some transient failures. Requiring a completed, successful
 * authentication state keeps protected UI and its data loads fail closed.
 */
export function adminAccess({
  user = null,
  authChecked = false,
  isAuthenticated = false,
  isLoadingAuth = true,
  authError = null,
} = {}) {
  if (isLoadingAuth) return 'checking';
  if (!authChecked) return authError ? 'denied' : 'checking';
  if (authError || !isAuthenticated || !isAdmin(user)) return 'denied';
  return 'admin';
}

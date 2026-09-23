import { isAdmin } from './isAdmin.js';

/** Only completed, successful authentication can mount admin UI or its data loads. */
export function adminAccess({
  user = null,
  authChecked = false,
  isAuthenticated = false,
  isLoadingAuth = true,
  authError = null,
} = {}) {
  if (isLoadingAuth) return 'checking';
  if (!authChecked) return authError ? 'denied' : 'checking';
  if (authError || !isAuthenticated || !user?.id || user.disabled || !isAdmin(user)) return 'denied';
  return 'admin';
}

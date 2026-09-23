// Presentation gate only. Entity RLS and backend authorization remain mandatory.
export function memberAccess({ isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, user }) {
  if (isLoadingAuth || isLoadingPublicSettings) return 'loading';
  if (authError?.type === 'user_not_registered') return 'unregistered';
  if (authError && authError.type !== 'auth_required') return 'unavailable';
  if (!authError && isAuthenticated && user?.id && !user.disabled) return 'member';
  return 'login';
}

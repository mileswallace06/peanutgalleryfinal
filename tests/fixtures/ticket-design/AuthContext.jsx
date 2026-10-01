import { createContext, useContext } from 'react';
import { base44, fixtureUser, fixtureSignedIn } from './base44';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const value = {
    user: fixtureSignedIn ? fixtureUser : null, isAuthenticated: fixtureSignedIn, isLoadingAuth: false,
    isLoadingPublicSettings: false, authError: null, appPublicSettings: null, authChecked: true,
    checkUserAuth: () => base44.auth.me(), checkAppState: () => base44.auth.me(),
    logout: () => base44.auth.logout(), navigateToLogin: () => base44.auth.redirectToLogin(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Visual review requires its fixture AuthProvider');
  return value;
}

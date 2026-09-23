import { createContext, useState, useContext, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { initOneSignal, loginOneSignalUser, logoutOneSignalUser } from '@/lib/oneSignal';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const authGeneration = useRef(0);

  useEffect(() => {
    initOneSignal();
    checkAppState();
  }, []);

  // Ask the existing SDK for the current session. A separate settings client
  // would retain the boot-time token after custom sign-in and race this check.
  const checkAppState = () => checkUserAuth();

  const checkUserAuth = async () => {
    const generation = ++authGeneration.current;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('auth_timeout')), 10000);
    });
    try {
      setIsLoadingAuth(true);
      const currentUser = await Promise.race([base44.auth.me({ fresh: true }), timeout]);
      if (generation !== authGeneration.current) return null;
      if (!currentUser?.id || currentUser.disabled) throw new Error('invalid_session');
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      setAuthError(null);
      // Fire-and-forget — must NOT block auth completion
      loginOneSignalUser(currentUser?.email).catch(() => {});
      return currentUser;
    } catch (error) {
      if (generation !== authGeneration.current) return null;
      const status = error?.status || error?.response?.status;
      const isTimeout = error?.message === 'auth_timeout';
      setUser(null);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      
      const reason = error?.data?.extra_data?.reason || error?.response?.data?.extra_data?.reason;
      if (reason === 'user_not_registered') {
        setAuthError({ type: 'user_not_registered', message: 'Account access is not available.' });
      } else if (status === 401 || status === 403 || error?.message === 'invalid_session') {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      } else {
        setAuthError({ type: 'unknown', message: isTimeout ? 'Sign-in check timed out.' : 'Unable to check sign-in.' });
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const logout = (shouldRedirect = true) => {
    authGeneration.current += 1;
    setUser(null);
    setIsAuthenticated(false);
    setIsLoadingAuth(false);
    setAuthChecked(true);
    setAuthError({ type: 'auth_required', message: 'Authentication required' });
    logoutOneSignalUser();
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.origin + '/');
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    window.location.assign('/login?from_url=%2Fevents');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

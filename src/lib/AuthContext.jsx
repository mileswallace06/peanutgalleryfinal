import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
import { initOneSignal, loginOneSignalUser, logoutOneSignalUser } from '@/lib/oneSignal';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    initOneSignal();
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      // Only clear auth error if we don't already have an authenticated user
      if (!user) setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        // Unblock the loading screen immediately — checkUserAuth runs independently
        setIsLoadingPublicSettings(false);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          // Unknown/network error — don't sign out if we already have a user session
          if (!user) {
            setAuthError({
              type: 'unknown',
              message: appError.message || 'Failed to load app'
            });
          }
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      // Don't sign out on transient errors if already authenticated
      if (!user) {
        setAuthError({
          type: 'unknown',
          message: error.message || 'An unexpected error occurred'
        });
      }
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    // Safety timeout — if auth check takes >10s, unblock the UI rather than hang forever
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('auth_timeout')), 10000)
    );
    try {
      setIsLoadingAuth(true);
      const currentUser = await Promise.race([base44.auth.me({ fresh: true }), timeout]);
      console.log('[Auth] user.id:', currentUser?.id, '| email:', currentUser?.email, '| role:', currentUser?.role);
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      // Fire-and-forget — must NOT block auth completion
      loginOneSignalUser(currentUser?.email).catch(err =>
        console.warn('[OneSignal] login failed (non-blocking):', err?.message)
      );
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const isTimeout = error?.message === 'auth_timeout';
      if (isTimeout) {
        console.error('[Auth] checkUserAuth timed out after 10s — unblocking UI');
      } else {
        console.error('[Auth] checkUserAuth failed — status:', status, '| message:', error?.message);
      }
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      
      if (!user && (status === 401 || status === 403)) {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      } else if (!user && isTimeout) {
        setAuthError({ type: 'auth_required', message: 'Authentication timed out. Please try again.' });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    logoutOneSignalUser();
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Redirect to Base44 auth with post-login destination back to the app
    base44.auth.redirectToLogin(window.location.origin + '/events');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
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
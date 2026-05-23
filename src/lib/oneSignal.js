/**
 * OneSignal Web SDK wrapper for Peanut Gallery.
 *
 * Usage:
 *   initOneSignal()           — call once on app boot (before auth)
 *   loginOneSignalUser(email) — call after user authenticates
 *   logoutOneSignalUser()     — call on logout
 */

import OneSignal from 'react-onesignal';

const ONESIGNAL_APP_ID = '8c9896d6-d4d6-4cdf-a094-3ba25bdd4585';

let initialized = false;

export async function initOneSignal() {
  if (initialized) return;
  initialized = true;

  try {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false }, // We handle prompts ourselves
      promptOptions: {
        slidedown: {
          enabled: false, // suppress automatic slidedown
        },
      },
    });
    console.log('[OneSignal] initialized');
  } catch (err) {
    console.warn('[OneSignal] init failed:', err?.message);
  }
}

/**
 * Link the authenticated user to their OneSignal subscription.
 * Call this right after base44.auth.me() succeeds.
 */
export async function loginOneSignalUser(email) {
  if (!email) return;
  try {
    await OneSignal.login(email);
    console.log('[OneSignal] logged in external user:', email);
  } catch (err) {
    console.warn('[OneSignal] login failed:', err?.message);
  }
}

/**
 * Unlink the user from their OneSignal subscription on logout.
 */
export async function logoutOneSignalUser() {
  try {
    await OneSignal.logout();
    console.log('[OneSignal] user logged out');
  } catch (err) {
    console.warn('[OneSignal] logout failed:', err?.message);
  }
}

/**
 * Prompt the user for push notification permission.
 * Returns 'granted' | 'denied' | 'default'
 */
export async function requestPushPermission() {
  try {
    await OneSignal.Notifications.requestPermission();
    return OneSignal.Notifications.permission ? 'granted' : 'denied';
  } catch (err) {
    console.warn('[OneSignal] permission request failed:', err?.message);
    return 'default';
  }
}

export default OneSignal;
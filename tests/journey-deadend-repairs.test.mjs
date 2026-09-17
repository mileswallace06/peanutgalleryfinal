import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  donate,
  tickets,
  win,
  transfer,
  stripe,
  dispute,
  notifications,
] = await Promise.all([
  read('src/components/donations/DonateSeatSheet.jsx'),
  read('src/pages/MyTickets.jsx'),
  read('src/components/donations/DonationWinNotification.jsx'),
  read('src/components/purchase/TransferAssistant.jsx'),
  read('src/components/account/StripePayoutSection.jsx'),
  read('src/components/purchase/DisputeModal.jsx'),
  read('src/components/account/NotificationsSection.jsx'),
]);

// Donation submission must recover from every failure and leave its receipt visible.
assert.match(donate, /try\s*\{[\s\S]*create_donation[\s\S]*catch\s*\(err\)[\s\S]*finally\s*\{/);
assert.match(donate, /setError\([\s\S]*We could not donate these seats/);
assert.match(donate, /setStep\('done'\)/);
assert.match(donate, /role="alert"/);
assert.doesNotMatch(tickets, /onDonated=\{\(\) => setDonatingPurchase\(null\)\}/);
assert.match(tickets, /onDonated=\{\(\) => fetchPurchases\(true\)\}/);

// An accepted donation cannot auto-decline after its countdown, trap the user,
// or extend beneath an iPhone safe area without a scroll path.
assert.match(win, /if \(!donation \|\| accepted !== null\) return/);
assert.match(win, /const handleClose = \(\) =>/);
assert.match(win, /aria-label="Close donation result"/);
assert.match(win, />\s*Done\s*<\/button>/);
assert.match(win, /maxHeight: 'calc\(100dvh/);
assert.match(win, /overflowY: 'auto'/);
assert.match(win, /env\(safe-area-inset-bottom\)/);

// Optional transfer proof and Stripe onboarding both surface failures and
// always release their loading state.
assert.match(transfer, /UploadFile[\s\S]*catch\s*\(err\)[\s\S]*setError[\s\S]*finally\s*\{[\s\S]*setUploading\(false\)/);
assert.match(transfer, /if \(!proofUrl\) throw new Error/);
assert.match(stripe, /onboardSeller[\s\S]*catch\s*\(err\)[\s\S]*setOnboardingError[\s\S]*finally\s*\{[\s\S]*setOnboarding\(false\)/);
assert.match(stripe, /role="alert"/);

// The dispute dialog uses theme tokens and remains reachable on compact phones.
assert.doesNotMatch(dispute, /className="bg-white/);
assert.match(dispute, /background: 'hsl\(var\(--card\)\)'/);
assert.match(dispute, /maxHeight: 'calc\(100dvh/);
assert.match(dispute, /overflow-y-auto/);
assert.match(dispute, /safe-area-inset-top/);
assert.match(dispute, /safe-area-inset-bottom/);

// Saved notification values replace placeholder defaults when auth resolves.
assert.match(notifications, /import \{ useEffect, useState \} from 'react'/);
assert.match(notifications, /useEffect\(\(\) => \{\s*if \(user\) setPrefs\(preferencesFor\(user\)\)/);
assert.match(notifications, /\}, \[user\]\)/);

console.log('journey dead-end repair checks passed');

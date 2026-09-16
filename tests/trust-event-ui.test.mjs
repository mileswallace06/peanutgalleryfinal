import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEmptyTicketCopy, getEventModeCopy } from '../src/lib/eventDetailPresentation.js';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('basic account setup never claims email presence is verification or a trust badge', () => {
  const verification = source('src/components/account/VerificationStatusSection.jsx');
  const security = source('src/components/account/SecuritySection.jsx');

  assert.match(verification, /Email added/);
  assert.match(verification, /Basic account setup complete/);
  assert.match(verification, /verification are shown only when separately confirmed/);
  assert.doesNotMatch(verification, /Email verified|Fully verified|trust badge/i);

  assert.match(security, />\s*On file\s*</);
  assert.doesNotMatch(security, />\s*Verified\s*</);
});

test('ended-event presentation makes no live, showtime, or future-opening promise', () => {
  assert.deepEqual(getEventModeCopy('ended'), {
    title: 'Event has ended',
    description: 'Live ticket and upgrade activity is closed',
    action: 'View status',
  });
  assert.deepEqual(getEmptyTicketCopy('ended'), {
    title: 'Ticket sales have closed',
    description: 'This event has ended, so ticket sales and live seat upgrades are no longer available.',
    action: 'Browse other events',
    destination: '/events',
  });

  const endedCopy = JSON.stringify({
    mode: getEventModeCopy('ended'),
    empty: getEmptyTicketCopy('ended'),
  });
  assert.doesNotMatch(endedCopy, /Open Now|Starting Soon|unlock at showtime|listing seat upgrades right now/i);
});

test('Event Detail closes listing actions after an event ends and describes general alert settings honestly', () => {
  const detail = source('src/pages/EventDetail.jsx');

  assert.match(detail, /const availableListings = isEnded \? \[\] : listings/);
  assert.match(detail, /isEnded \? 'Ticket Sales Closed' : 'Available Tickets'/);
  assert.match(detail, /Manage notification preferences/);
  assert.match(detail, /Choose which app and email alerts you receive/);
  assert.match(detail, /<Link to="\/account-settings"/);
  assert.doesNotMatch(detail, /Get notified when tickets drop|alert you the moment a listing goes live/);
});

test('event rows use one full-card link with no nested interactive link', () => {
  const events = source('src/pages/Events.jsx');
  const eventRow = events.slice(events.indexOf('function EventRow'));

  assert.match(eventRow, /const Card = cardUrl \? Link : 'div'/);
  assert.match(eventRow, /<Card\s+[\s\S]*\{\.\.\.cardProps\}/);
  assert.match(eventRow, /'aria-label': `\$\{isLive \? 'Open Live Hub for' : 'View'\} \$\{event\.title\}`/);
  assert.match(eventRow, /focus-visible:ring-2/);
  assert.doesNotMatch(eventRow, /<Link\b/);
});

test('mailto actions are labeled as email handoffs, not in-app destinations', () => {
  const support = source('src/components/account/SupportLegalSection.jsx');
  const security = source('src/components/account/SecuritySection.jsx');

  assert.match(support, /label: 'Email a Help Request'/);
  assert.match(support, /label: 'Email Support'/);
  assert.doesNotMatch(support, /label: 'Help Center'/);
  assert.match(security, /Email support/);
  assert.doesNotMatch(security, />\s*Change\s*</);
});

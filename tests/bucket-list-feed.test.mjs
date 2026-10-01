import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBucketListPosts } from '../src/components/fanzone/bucketListFeed.js';

const posts = [
  { id: 'a', event_id: 'show', event_title: 'A Night Out', text: 'Great view!' },
  { id: 'b', event_id: 'other', event_title: 'Another show', text: 'Same venue name, different city.' },
  { id: 'c', text: 'I want to see The Aurora Waves live.' },
];
const events = [
  { id: 'show', title: 'A Night Out', artist: 'The Aurora Waves', venue: 'Garden Theater', tm_venue_id: 'garden-one' },
  { id: 'other', title: 'Another show', venue: 'Garden Theater', tm_venue_id: 'garden-two' },
];

test('an empty or blank bucket list never turns into an unfiltered feed', () => {
  assert.deepEqual(filterBucketListPosts(posts, [], events), []);
  assert.deepEqual(filterBucketListPosts(posts, [{ type: 'attraction', name: '  ' }], events), []);
});

test('artists and teams match post mentions and linked event performers', () => {
  assert.deepEqual(filterBucketListPosts(posts, [{ name: '  THE AURORA WAVES  ', type: 'attraction' }], events).map(post => post.id), ['a', 'c']);
});

test('venue IDs distinguish places with the same name and match posts without venue text', () => {
  assert.deepEqual(filterBucketListPosts(posts, [{ name: 'Garden Theater', type: 'venue', tm_id: 'garden-one' }], events).map(post => post.id), ['a']);
});

test('legacy events without venue IDs still match venue metadata', () => {
  assert.deepEqual(filterBucketListPosts(posts, [{ name: 'garden theater', type: 'venue', tm_id: 'garden-one' }], [{ ...events[0], tm_venue_id: null }]).map(post => post.id), ['a']);
});

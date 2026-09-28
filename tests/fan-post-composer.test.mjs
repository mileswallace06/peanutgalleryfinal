import test from 'node:test';
import assert from 'node:assert/strict';
import { createFanPostTasks, fanPostPayload, fanPostProblem, hasFanPostDraft } from '../src/components/fanzone/fanPostDraft.js';

const user = { email: 'fan@example.test', full_name: 'Fan Name' };
const draft = { type: 'post', text: '', event: null, photo: '', before: '', after: '', fromSection: '', fromRow: '', toSection: '', toRow: '' };
const file = { name: 'photo.jpg', type: 'image/jpeg' };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('text-only and photo-only posts use the existing FanPost fields', () => {
  const payload = fanPostPayload(user, { ...draft, text: '  What a night  ' });
  assert.equal(payload.text, 'What a night');
  assert.equal(payload.author_email, user.email);
  assert.equal(payload.author_name, 'Fan Name');
  assert.equal(payload.photo_url, null);
  assert.equal(payload.post_type, 'post');
  assert.equal(payload.event_id, null);
  assert.deepEqual(payload.reactions, { fire: [], eyes: [], peanut: [] });
  const photo = fanPostPayload(user, { ...draft, photo: 'https://example.test/photo.jpg' });
  assert.equal(photo.photo_url, 'https://example.test/photo.jpg');
  assert.ok(photo.text.trim());
});

test('blank authors and blank posts cannot reach create', async () => {
  let calls = 0;
  const tasks = createFanPostTasks({ upload() {}, createPost() { calls++; } });
  for (const actor of [null, {}, { email: '' }, { email: '  ' }]) {
    await assert.rejects(tasks.share(actor, { ...draft, text: 'hello' }), /Sign in/);
  }
  await assert.rejects(tasks.share(user, draft), /Write something/);
  assert.equal(calls, 0);
});

test('Seat Flex requires its event and a photo, but caption and seat details remain optional', () => {
  const flex = { ...draft, type: 'seat_flex', after: 'https://example.test/after.jpg' };
  assert.match(fanPostProblem(user, flex), /event/);
  assert.match(fanPostProblem(user, { ...flex, after: '', event: { id: 'e1' } }), /photo/);
  assert.equal(fanPostProblem(user, { ...flex, event: { id: 'e1' } }), null);
});

test('Seat Flex preserves event, before/after, seat, and reaction payload contracts', () => {
  const payload = fanPostPayload(user, { ...draft, type: 'seat_flex', event: { id: 'e1', title: 'Live show', city: 'Phoenix' },
    before: 'https://example.test/before.jpg', after: 'https://example.test/after.jpg', fromSection: ' 201 ', fromRow: ' 8 ', toSection: ' 101 ', toRow: ' 2 ' });
  assert.equal(payload.post_type, 'seat_flex');
  assert.equal(payload.event_id, 'e1');
  assert.equal(payload.event_title, 'Live show');
  assert.equal(payload.event_city, 'Phoenix');
  assert.equal(payload.from_section, '201');
  assert.equal(payload.to_section, '101');
  assert.equal(payload.from_row, '8');
  assert.equal(payload.to_row, '2');
  assert.equal(payload.before_photo_url, 'https://example.test/before.jpg');
  assert.equal(payload.after_photo_url, 'https://example.test/after.jpg');
  assert.equal(payload.text, 'Moved from Sec 201 Row 8 → Sec 101 Row 2');
  assert.equal('photo_url' in payload, false);
});

test('all meaningful draft changes require discard confirmation', () => {
  assert.equal(hasFanPostDraft(draft), false);
  assert.equal(hasFanPostDraft({ ...draft, text: '  ' }), false);
  for (const [key, value] of Object.entries({ text: 'hello', event: { id: 'e1' }, photo: 'url', before: 'url', after: 'url', fromSection: '201', toRow: '2' })) {
    assert.equal(hasFanPostDraft({ ...draft, [key]: value }), true, key);
  }
});

test('double Share taps and taps after acknowledgement create only one post', async () => {
  const request = defer();
  let calls = 0;
  const tasks = createFanPostTasks({ upload() {}, createPost() { calls++; return request.promise; } });
  const first = tasks.share(user, { ...draft, text: 'hello' });
  assert.equal((await tasks.share(user, { ...draft, text: 'hello' })).status, 'busy');
  assert.equal(calls, 1);
  request.resolve({ id: 'p1' });
  assert.deepEqual(await first, { status: 'posted', post: { id: 'p1' } });
  assert.equal((await tasks.share(user, { ...draft, text: 'hello' })).status, 'busy');
  assert.equal(calls, 1);
});

test('pending uploads prevent posting until both photos finish', async () => {
  const before = defer(), after = defer();
  let calls = 0, uploads = 0;
  const tasks = createFanPostTasks({ upload() { return ++uploads === 1 ? before.promise : after.promise; }, createPost() { calls++; return { id: 'p1' }; } });
  const first = tasks.uploadPhoto(file, 'before');
  const second = tasks.uploadPhoto(file, 'after');
  assert.equal((await tasks.share(user, { ...draft, text: 'hello' })).status, 'busy');
  before.resolve({ file_url: 'before' });
  assert.equal(await first, 'before');
  assert.equal((await tasks.share(user, { ...draft, text: 'hello' })).status, 'busy');
  after.resolve({ file_url: 'after' });
  assert.equal(await second, 'after');
  assert.equal((await tasks.share(user, { ...draft, text: 'hello' })).status, 'posted');
  assert.equal(calls, 1);
});

test('duplicate photo selection cannot start overlapping uploads to the same slot', async () => {
  const pending = defer();
  let calls = 0;
  const tasks = createFanPostTasks({ upload() { calls++; return pending.promise; }, createPost() {} });
  const first = tasks.uploadPhoto(file, 'photo');
  assert.equal(await tasks.uploadPhoto(file, 'photo'), null);
  assert.equal(calls, 1);
  pending.resolve({ file_url: 'photo' });
  assert.equal(await first, 'photo');
});

test('failed uploads release their lock and preserve draft for a deliberate retry', async () => {
  let calls = 0;
  const saved = { ...draft, text: 'Keep this caption' };
  const tasks = createFanPostTasks({ upload() { if (++calls === 1) throw new Error('offline'); return { file_url: 'photo' }; }, createPost() {} });
  await assert.rejects(tasks.uploadPhoto(file, 'photo'), /offline/);
  assert.equal(saved.text, 'Keep this caption');
  assert.equal(await tasks.uploadPhoto(file, 'photo'), 'photo');
});

test('bad file and missing upload URL fail before publishing', async () => {
  let uploads = 0;
  const tasks = createFanPostTasks({ upload() { uploads++; return {}; }, createPost() { assert.fail('Must not create'); } });
  await assert.rejects(tasks.uploadPhoto({ type: 'application/pdf' }, 'photo'), /image/);
  assert.equal(uploads, 0);
  await assert.rejects(tasks.uploadPhoto(file, 'photo'), /photo/);
  assert.equal(uploads, 1);
});

test('a rejected Share leaves the draft unchanged and permits a deliberate retry', async () => {
  let calls = 0;
  const saved = { ...draft, text: 'Keep this', photo: 'https://example.test/photo.jpg' };
  const original = structuredClone(saved);
  const tasks = createFanPostTasks({ upload() {}, createPost() { if (++calls === 1) throw new Error('offline'); return { id: 'p1' }; } });
  await assert.rejects(tasks.share(user, saved), /offline/);
  assert.deepEqual(saved, original);
  assert.equal((await tasks.share(user, saved)).status, 'posted');
});

test('upload cannot mutate the photo selection while sharing', async () => {
  const pending = defer();
  const tasks = createFanPostTasks({ upload() { assert.fail('No uploads during share'); }, createPost() { return pending.promise; } });
  const first = tasks.share(user, { ...draft, text: 'hello' });
  assert.equal(await tasks.uploadPhoto(file, 'photo'), null);
  pending.resolve({ id: 'p1' });
  await first;
});

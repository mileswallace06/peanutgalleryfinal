import '../ticket-design/setup.js';
const params = new URLSearchParams(location.search);
const end = Date.parse('2099-10-09T21:00:00Z');
let now = end + ({ before: -1, exact: 0, after: 1, live: -1800000, unknown: 1 }[params.get('phase') || 'after']);
Date.now = () => now;
window.lifecycleClock = { end, set(value) { now = value; window.dispatchEvent(new Event('focus')); } };

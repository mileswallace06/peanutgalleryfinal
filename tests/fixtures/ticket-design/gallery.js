const params = new URLSearchParams(location.search);
const page = params.get('page') || 'events';
const scenario = ['populated', 'empty', 'provider-error'].includes(params.get('scenario')) ? params.get('scenario') : 'populated';
const width = ['320', '390', '430'].includes(params.get('width')) ? params.get('width') : 'all';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const pages = [['events', 'Tickets'], ['upgrades', 'Upgrades'], ['hub', 'Live event hub'], ['sell', 'Sell'], ['fan-zone', 'Fan Zone'], ['my-tickets', 'My Tickets'], ['my-sales', 'My Sales'], ['account-settings', 'Account Settings'], ['founder', 'Founder'], ['seller-payout-guide', 'Payout Guide'], ['upgrades-intro', 'Upgrades Introduction']];
for (const [key, label] of pages) {
  const link = document.createElement('a');
  const next = new URLSearchParams({ page: key, scenario, width, theme });
  link.href = `?${next}`; link.textContent = label;
  if (page === key) link.setAttribute('aria-current', 'page');
  document.getElementById('pages').append(link);
}
for (const [id, current] of [['scenario', scenario], ['width', width], ['theme', theme]]) {
  const control = document.getElementById(id); control.value = current;
  control.addEventListener('change', () => { params.set('page', page); params.set(id, control.value); location.search = params.toString(); });
}
document.getElementById('note').textContent = 'Dates are relative to this preview session’s real current time.';
for (const w of width === 'all' ? [320, 390, 430] : [Number(width)]) {
  const figure = document.createElement('figure'); figure.className = 'device';
  const caption = document.createElement('figcaption'); caption.textContent = `${w} × 844 · ${scenario} · ${theme}`;
  const frame = document.createElement('iframe'); frame.title = `PG ${w}px visual review`; frame.id = `preview-${w}`; frame.name = `preview-${w}`;
  frame.width = String(w); frame.height = '844'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.src = `./app.html?${new URLSearchParams({ page, scenario, theme })}`;
  figure.append(caption, frame); document.getElementById('gallery').append(figure);
}

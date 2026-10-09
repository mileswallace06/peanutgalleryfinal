/** Presentation-only repairs for provider-authored policies. Legal wording is preserved. */
function replaceTag(element, tagName) {
  const replacement = element.ownerDocument.createElement(tagName);
  for (const attribute of element.attributes) replacement.setAttribute(attribute.name, attribute.value);
  replacement.append(...element.childNodes);
  element.replaceWith(replacement);
  return replacement;
}

export function prepareLegalDocument(root, { title = '', tableLabel = 'Policy details' } = {}) {
  if (!root) return;
  const normalizedTitle = title.toLowerCase().replace(/[^a-z]/g, '');
  // Some Termly subheadings are styled div/span elements instead of headings.
  for (const element of root.querySelectorAll('[data-custom-class="heading_1"], [data-custom-class="heading_2"]')) {
    if (element.matches('h1, h2, h3, h4, h5, h6') || element.querySelector('h1, h2, h3, h4, h5, h6')) continue;
    replaceTag(element, element.dataset.customClass === 'heading_2' ? 'h3' : 'h2');
  }
  let previousLevel = 1;
  for (const original of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const originalLevel = Number(original.dataset.pgOriginalLevel || original.tagName.slice(1));
    const text = original.textContent.toLowerCase().replace(/[^a-z]/g, '');
    if (originalLevel === 1 && normalizedTitle && text === normalizedTitle) {
      const label = replaceTag(original, 'p');
      label.classList.add('pg-legal-source-title');
      continue;
    }
    const level = Math.min(Math.max(2, originalLevel), previousLevel + 1);
    const heading = original.tagName === `H${level}` ? original : replaceTag(original, `h${level}`);
    heading.dataset.pgOriginalLevel = String(originalLevel);
    previousLevel = level;
  }

  [...root.querySelectorAll('table')].forEach((table, index) => {
    if (table.parentElement?.classList.contains('pg-legal-table-scroll')) return;
    const doc = root.ownerDocument;
    const region = doc.createElement('div');
    region.className = 'pg-legal-table-scroll';
    region.tabIndex = 0;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', `${table.caption?.textContent.trim() || tableLabel}${index ? ` ${index + 1}` : ''} — scroll horizontally to view all columns`);
    const columnCount = Math.max(1, ...[...table.rows].map(row => [...row.cells].reduce((sum, cell) => sum + (cell.colSpan || 1), 0)));
    table.style.setProperty('--pg-legal-columns', String(columnCount));
    table.before(region);
    region.append(table);
    for (const cell of table.querySelectorAll('thead th, tr:first-child th')) {
      if (!cell.hasAttribute('scope')) cell.setAttribute('scope', 'col');
    }
    // Replace raw URL link labels only. Keep URLs and any supplied descriptive text.
    for (const link of table.querySelectorAll('a[href]')) {
      if (!/^https?:\/\//i.test(link.textContent.trim())) continue;
      try {
        const url = new URL(link.getAttribute('href'));
        if (!['https:', 'http:'].includes(url.protocol)) continue;
        const provider = link.closest('tr')?.cells[0]?.textContent.trim();
        const description = /privacy|datenschutz/i.test(url.pathname) ? 'Privacy policy' : 'Website';
        link.textContent = `${description} — ${provider && provider.length < 80 ? provider : url.hostname}`;
      } catch { /* Preserve malformed or relative provider links verbatim. */ }
    }
  });
}

export function findLegalFragment(root, hash) {
  if (!hash || hash === '#') return null;
  let id;
  try { id = decodeURIComponent(hash.replace(/^#/, '')); } catch { return null; }
  // Do not build selectors from a URL fragment; named legacy anchors also work.
  return [...root.querySelectorAll('[id], a[name]')].find(node => node.id === id || node.getAttribute('name') === id) || null;
}

export function scrollLegalFragment(scroller, target, { focus = true } = {}) {
  if (!scroller || !target) return false;
  const headerHeight = scroller.querySelector('.pg-public-header')?.getBoundingClientRect().height || 0;
  const offset = headerHeight + 16;
  scroller.style.setProperty('--pg-public-scroll-offset', `${offset}px`);
  const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
  // Instant positioning also honors reduced-motion preferences and does not
  // race native fragment smooth scrolling or a later async provider mount.
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  if (focus) {
    const heading = target.matches('h1, h2, h3, h4, h5, h6') ? target : target.querySelector('h1, h2, h3, h4, h5, h6');
    const focusTarget = heading || target;
    if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
  }
  return true;
}

// Only the summary echo is shortened; search and the editable input stay intact.
export function helpQuerySummary(query, limit = 80) {
  const characters = Array.from(String(query || '').trim());
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : characters.join('');
}

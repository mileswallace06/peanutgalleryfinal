import { isAdmin } from './isAdmin.js';

export const FEEDBACK_CATEGORIES = { bug: 'Bug', confused: 'Confused', love: 'Love', idea: 'Idea' };
export const FEEDBACK_PAGE_SIZE = 50;

export function feedbackAccess({ user, authChecked, isAuthenticated, isLoadingAuth }) {
  if (!authChecked || isLoadingAuth) return 'checking';
  return isAuthenticated && isAdmin(user) ? 'admin' : 'denied';
}

export async function loadFeedbackPage(base44, user, category = 'all', offset = 0) {
  if (!isAdmin(user)) throw new Error('admin_required');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_offset');
  if (category !== 'all' && !Object.hasOwn(FEEDBACK_CATEGORIES, category)) throw new Error('invalid_category');
  const rows = await base44.entities.BetaFeedbackEvent.filter(
    category === 'all' ? {} : { feedback_type: category }, '-created_date', FEEDBACK_PAGE_SIZE + 1, offset);
  if (!Array.isArray(rows)) throw new Error('invalid_feedback_response');
  return { rows: rows.slice(0, FEEDBACK_PAGE_SIZE), hasMore: rows.length > FEEDBACK_PAGE_SIZE };
}

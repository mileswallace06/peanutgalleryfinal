import { isAdmin } from './isAdmin.js';

export const FEEDBACK_CATEGORIES = { bug: 'Bug', confused: 'Confusion', idea: 'Idea', love: 'Praise' };
export const FEEDBACK_PAGE_SIZE = 50;

export async function loadFeedbackPage(base44, user, category = 'all', offset = 0) {
  if (!isAdmin(user)) throw new Error('admin_required');
  if (category !== 'all' && !Object.hasOwn(FEEDBACK_CATEGORIES, category)) throw new Error('invalid_category');
  const rows = await base44.entities.BetaFeedbackEvent.filter(
    category === 'all' ? {} : { feedback_type: category }, '-created_date', FEEDBACK_PAGE_SIZE + 1, offset);
  if (!Array.isArray(rows)) throw new Error('invalid_feedback_response');
  return { rows: rows.slice(0, FEEDBACK_PAGE_SIZE), hasMore: rows.length > FEEDBACK_PAGE_SIZE };
}

export async function submitAcceptedFeedback(base44, payload) {
  const response = await base44.functions.invoke('submitFeedback', payload);
  if (response?.data?.status !== 'submitted' || !response.data.id) throw new Error('feedback_not_accepted');
  return response.data;
}

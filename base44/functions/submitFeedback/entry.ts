/**
 * submitFeedback — authenticated feedback submission with server-side cooldowns.
 *
 * Replaces direct client-side BetaFeedbackEvent.create() (M0.1) with a
 * server-side function that enforces:
 *   - 60s cooldown between submissions per user
 *   - Max 3 submissions per 10-minute rolling window per user
 *
 * User identity is derived from the authenticated session (created_by_id is
 * auto-set by Base44). Client-supplied email/name fields are ignored.
 *
 * Body: { feedback_type, page, message }
 *   - feedback_type: 'bug' | 'confused' | 'love' | 'idea' (required)
 *   - page: string (required, max 500 chars)
 *   - message: string (optional, max 2000 chars)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COOLDOWN_MS = 60 * 1000;        // 60s between submissions
const WINDOW_MS = 10 * 60 * 1000;     // 10-minute rolling window
const MAX_PER_WINDOW = 3;             // max 3 per 10 min

const VALID_TYPES = ['bug', 'confused', 'love', 'idea'];
const MAX_PAGE_LEN = 500;
const MAX_MESSAGE_LEN = 2000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { feedback_type, page, message } = body;

    // ── Input validation ──────────────────────────────────────────────────
    if (!feedback_type || !VALID_TYPES.includes(feedback_type)) {
      return Response.json({ error: 'invalid_feedback_type' }, { status: 400 });
    }
    if (!page || typeof page !== 'string' || page.length > MAX_PAGE_LEN) {
      return Response.json({ error: 'invalid_page' }, { status: 400 });
    }
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN) {
        return Response.json({ error: 'invalid_message' }, { status: 400 });
      }
    }

    // ── Server-side cooldown enforcement ──────────────────────────────────
    // Read the user's 3 most recent feedback events (sorted newest first).
    const recent = await base44.entities.BetaFeedbackEvent.filter(
      { created_by_id: user.id },
      '-created_date',
      MAX_PER_WINDOW,
      0
    );

    const now = Date.now();

    // 60s cooldown: reject if last submission was within COOLDOWN_MS
    if (recent.length > 0) {
      const lastAt = new Date(recent[0].created_date).getTime();
      const elapsed = now - lastAt;
      if (elapsed < COOLDOWN_MS) {
        return Response.json(
          { error: 'cooldown', retry_after: Math.ceil((COOLDOWN_MS - elapsed) / 1000) },
          { status: 429 }
        );
      }
    }

    // 3 per 10 min: reject if 3 submissions exist within the rolling window
    if (recent.length >= MAX_PER_WINDOW) {
      const oldestAt = new Date(recent[recent.length - 1].created_date).getTime();
      const windowElapsed = now - oldestAt;
      if (windowElapsed < WINDOW_MS) {
        return Response.json(
          { error: 'rate_limit', retry_after: Math.ceil((WINDOW_MS - windowElapsed) / 1000) },
          { status: 429 }
        );
      }
    }

    // ── Create feedback record ─────────────────────────────────────────────
    // created_by_id is auto-set by Base44 — never trust client-supplied identity.
    await base44.entities.BetaFeedbackEvent.create({
      feedback_type,
      page,
      message: (message || '').trim() || null,
    });

    return Response.json({ status: 'submitted' });
  } catch (_error) {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
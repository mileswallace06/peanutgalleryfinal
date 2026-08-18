/**
 * submitFeedback — authenticated feedback submission with server-side cooldowns.
 *
 * M0.3 CORRECTIONS:
 *  - rls.create on BetaFeedbackEvent is now FALSE. All submissions must go
 *    through this function — direct client BetaFeedbackEvent.create() is denied.
 *  - submitter_user_id is derived EXCLUSIVELY from the authenticated user.id
 *    via base44.asServiceRole. Client-supplied submitter_user_id, user_email,
 *    user_name, and created_by_id are never read or persisted.
 *  - Cooldown lookup uses asServiceRole filtered by submitter_user_id (not
 *    created_by_id), so it works regardless of RLS on the entity.
 *  - Only allowlisted fields are persisted: feedback_type, page, message,
 *    screenshot_url, submitter_user_id.
 *  - Returns { status: "submitted", id }.
 *
 * COOLDOWN HONESTY: The read-then-create cooldown is a best-effort check under
 * simultaneous requests. Two concurrent calls that both pass the read before
 * either creates can both succeed. This is NOT an atomic rate limit. Base44
 * does not provide a compare-and-set primitive, so a true atomic per-user
 * cooldown is not achievable here. The 60s cooldown is effective against
 * sequential rapid re-submission (the common case) and double-taps, but not
 * against a deliberate concurrent burst.
 *
 * Body: { feedback_type, page, message?, screenshot_url? }
 *   - feedback_type: 'bug' | 'confused' | 'love' | 'idea' (required)
 *   - page: string (required, max 500 chars)
 *   - message: string (optional, max 2000 chars)
 *   - screenshot_url: string (optional, max 2048 chars)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COOLDOWN_MS = 60 * 1000;        // 60s between submissions
const WINDOW_MS = 10 * 60 * 1000;     // 10-minute rolling window
const MAX_PER_WINDOW = 3;             // max 3 per 10 min

const VALID_TYPES = ['bug', 'confused', 'love', 'idea'];
const MAX_PAGE_LEN = 500;
const MAX_MESSAGE_LEN = 2000;
const MAX_SCREENSHOT_LEN = 2048;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // ── Input validation (allowlist only) ───────────────────────────────────
    // Extract only allowlisted fields. Client-supplied submitter_user_id,
    // user_email, user_name, created_by_id are NEVER read.
    const feedback_type = body.feedback_type;
    const page = typeof body.page === 'string' ? body.page.slice(0, MAX_PAGE_LEN) : '';
    const message = body.message;
    const screenshot_url = body.screenshot_url;

    if (!feedback_type || !VALID_TYPES.includes(feedback_type)) {
      return Response.json({ error: 'invalid_feedback_type' }, { status: 400 });
    }
    if (!page) {
      return Response.json({ error: 'invalid_page' }, { status: 400 });
    }
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN) {
        return Response.json({ error: 'invalid_message' }, { status: 400 });
      }
    }
    if (screenshot_url !== undefined && screenshot_url !== null) {
      if (typeof screenshot_url !== 'string' || screenshot_url.length > MAX_SCREENSHOT_LEN) {
        return Response.json({ error: 'invalid_screenshot_url' }, { status: 400 });
      }
    }

    // ── Server-side cooldown enforcement (best-effort, see HONESTY above) ──
    // Use asServiceRole so the lookup works even though rls.create=false and
    // read is admin-only. Filter by submitter_user_id (the authoritative key).
    const recent = await base44.asServiceRole.entities.BetaFeedbackEvent.filter(
      { submitter_user_id: user.id },
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

    // ── Create feedback record (asServiceRole, allowlisted fields only) ────
    // submitter_user_id is derived exclusively from user.id — never from body.
    const created = await base44.asServiceRole.entities.BetaFeedbackEvent.create({
      submitter_user_id: user.id,
      feedback_type,
      page,
      message: (typeof message === 'string' ? message : '').trim() || null,
      screenshot_url: typeof screenshot_url === 'string' ? screenshot_url : null,
    });

    return Response.json({ status: 'submitted', id: created.id });
  } catch (_error) {
    // Never log or return raw exceptions
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
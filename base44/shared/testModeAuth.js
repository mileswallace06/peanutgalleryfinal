/**
 * Test Mode Authorization Helper (Round 6B.2)
 *
 * Server-authorizes test mode for listing creation. Non-admin users
 * requesting test mode get 403 before any entity mutation or provider call.
 *
 * Admin status is derived exclusively from the authenticated user's role —
 * never from body.is_admin, headers, email input, or any client-supplied
 * role field.
 *
 * This module is pure ESM JavaScript — no Deno or Node-specific imports.
 * It is importable by both backend functions (Deno) and tests (Node).
 */

/**
 * Authorize listing creation, enforcing test-mode and maintenance gates.
 *
 * @param {string} userRole - Authenticated user's role ('admin' or 'user')
 * @param {object} requestBody - The parsed request body (may contain is_test)
 * @param {boolean} maintenanceActive - Whether maintenance mode is currently active
 * @returns {object} Authorization result:
 *   - { authorized: true, isTest, isAdmin } — proceed with listing creation
 *   - { authorized: false, status, body } — return this response, zero writes
 */
export function authorizeListingCreation(userRole, requestBody, maintenanceActive) {
  const isAdmin = userRole === 'admin';
  const requestedTestMode = requestBody?.is_test === true;

  // 1. Non-admin + test mode → 403 before any mutation or provider call.
  //    This prevents non-admins from using is_test:true to bypass validation.
  if (requestedTestMode && !isAdmin) {
    return {
      authorized: false,
      status: 403,
      body: { error: 'Test mode is admin-authorized only', code: 'FORBIDDEN' },
    };
  }

  const isTest = requestedTestMode;

  // 2. Maintenance gate — only admin+test gets dry-run; all others get 503.
  //    Since isTest implies isAdmin (non-admin+isTest already returned 403),
  //    isAdmin && isTest is equivalent to isTest here.
  if (maintenanceActive && !(isAdmin && isTest)) {
    return {
      authorized: false,
      status: 503,
      body: { error: 'Listing creation is temporarily unavailable for scheduled maintenance.' },
    };
  }
  if (maintenanceActive && isAdmin && isTest) {
    return {
      authorized: false,
      status: 200,
      body: {
        dry_run: true,
        created: false,
        message: 'Maintenance dry run: no listing, SeatInventory, or verification log was created.',
      },
    };
  }

  return { authorized: true, isTest, isAdmin };
}

/**
 * Derive consistent test-mode labeling for Listing and ListingPrivate.
 * Both entities must receive the same is_demo_listing value and notes.
 *
 * @param {boolean} isTest - Whether this is a test-mode listing
 * @returns {{ notes: string|undefined, is_demo_listing: boolean }}
 */
export function deriveTestModeLabeling(isTest) {
  return {
    notes: isTest ? '[TEST] Admin/demo listing' : undefined,
    is_demo_listing: isTest,
  };
}
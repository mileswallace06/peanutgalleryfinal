# Listing.status & hidden_reason — Read/Write Inventory (Round 4)

## Ownership Contract (Round 4)

`Listing.status` and `Listing.hidden_reason` are **business publication states**.
They are owned by **business logic**, NOT by the reservation authority mirror.

### Normal Authority Projection
- Writes ONLY `reservation_version` and `reservation_mirror_state`.
- Does NOT write `status` or `hidden_reason`.
- Does NOT reopen business-held statuses (hidden, pending_verification, pending_payout_setup).
- Does NOT clear business-held hidden reasons (admin_disabled, transfer_disabled, expired_verification).

### Emergency Protection
- May set `status=hidden` and `hidden_reason=checkout_quarantine`.
- This is the ONLY time the authority touches `status`/`hidden_reason`.

### Terminal Business Status Changes
- Must use an **explicit finalization contract**, not generic blind sweep behavior.
- The sweep/projection sets `reservation_mirror_state` to the terminal state (sold/cancelled/expired).
- Business logic reads `reservation_mirror_state` and applies the finalization contract to change `status`.

## Read/Write Inventory

### Backend Functions (Writers of status/hidden_reason)

| Function | Writes status? | Writes hidden_reason? | Notes |
|----------|----------------|----------------------|-------|
| submitListing | YES (create) | YES (create) | Sets initial status (active, pending_payout_setup, pending_verification) |
| approveListingReview | YES | YES | Sets status=active, clears hidden_reason |
| rejectListingReview | YES | YES | Sets status=hidden, hidden_reason=admin_disabled |
| capturePayment (freeze) | YES | YES | Sets status=hidden, hidden_reason=checkout_quarantine |
| capturePayment (finalize) | YES | YES | Sets status=sold (terminal finalization) |
| abortCheckout | YES | YES | Restores status=active, clears hidden_reason=checkout_quarantine |
| cancelPurchase | YES | YES | Sets status=cancelled (terminal finalization) |
| cleanupAbandonedCheckouts | YES | YES | Restores status=active, clears hidden_reason=checkout_quarantine |
| stripeWebhook | YES | YES | May set status=sold (terminal finalization) |
| releaseReservation | YES | YES | Restores status=active, clears hidden_reason |
| deleteAccount | YES | YES | Sets status=cancelled for seller's listings |
| resumeOrchestrator | YES | YES | Restores status=active, clears hidden_reason=checkout_quarantine |
| reservationAuthorityMirror (protectMirror) | YES (emergency) | YES (emergency) | Sets status=hidden, hidden_reason=checkout_quarantine ONLY |
| reservationAuthorityMirror (projectMirror/sweepMirror) | NO | NO | Round 4: writes only reservation_mirror_state |

### Backend Functions (Readers of status/hidden_reason)

| Function | Reads status? | Reads hidden_reason? | Notes |
|----------|--------------|---------------------|-------|
| getTicketmasterEvents | NO | NO | |
| syncTMEvent | NO | NO | |
| reserveListing | YES | YES | Checks status=active before reserving |
| createCheckout | YES | YES | Checks status=active before checkout |
| confirmCheckoutAuthorized | YES | YES | Verifies listing is still active |
| captureReconciliation | YES | YES | Verifies status before freeze/finalize |
| processTransferReminders | YES | YES | Checks status for reminder logic |
| reconcilePurchaseOutcomes | YES | YES | Reconciles status with purchase state |
| verifyTransferProof | YES | YES | May update status based on verification |
| adminOverrideAIVerification | YES | YES | Admin may override status |
| recordTransferOutcome | YES | YES | Records terminal outcome |
| syncInventoryOnListingChange | YES | YES | Syncs SeatInventory with listing status |
| flashDrop | YES | YES | Checks listing status for flash drop |
| seatDonation | YES | YES | Checks listing status for donation |

### Frontend Consumers (Readers of status/hidden_reason)

| Component | Reads status? | Reads hidden_reason? | Notes |
|-----------|--------------|---------------------|-------|
| ListingCard | YES | YES | Displays status badge, filters by status |
| ListingStatusBanner | YES | YES | Shows status-specific messaging |
| TransferStatusBadge | YES | NO | Shows transfer-related status |
| EventDetail | YES | YES | Filters visible listings by status |
| Events | YES | YES | Shows only active listings |
| MySales | YES | YES | Shows seller's listings by status |
| MyTickets | YES | YES | Shows buyer's purchases by status |
| CreateListing | YES | YES | Shows draft/pending_payout_setup status |
| AdminCommandCenter | YES | YES | Admin views all statuses |
| PurchaseDialog | YES | YES | Checks status before allowing purchase |
| listingVisibility (lib) | YES | YES | Determines if listing is visible |
| EventMode | YES | YES | Shows active listings for live upgrades |
| MoveCloserListing | YES | YES | Shows active listings for upgrades |
| SellSeatsModule | YES | YES | Shows seller's seats by status |

## Reservation Mirror State vs Business Status

| Reservation Mirror State | Business Status (examples) | Notes |
|------------------------|---------------------------|-------|
| available | active, hidden, pending_verification, pending_payout_setup | Reservation is available; business may restrict visibility |
| reserved | active, hidden | Reservation held; business status independent |
| frozen | active, hidden | Reservation frozen for checkout; business status independent |
| sold | active, sold | Reservation finalized; business finalization sets status=sold |
| cancelled | active, cancelled | Reservation cancelled; business finalization sets status=cancelled |
| expired | active, expired | Reservation expired; business finalization sets status=expired |

## Reserved-State Compatibility with pending_transfer

The `pending_transfer` business status represents a checkout in progress. Compatibility:
- `reservation_mirror_state=reserved` + `status=pending_transfer` is VALID.
- The reservation authority sets `reservation_mirror_state=reserved` during checkout.
- Business logic sets `status=pending_transfer` during checkout.
- On successful capture: authority sets `reservation_mirror_state=sold`, business logic sets `status=sold`.
- On abort: authority sets `reservation_mirror_state=available`, business logic sets `status=active`.
- This compatibility must be formally defined before production integration.
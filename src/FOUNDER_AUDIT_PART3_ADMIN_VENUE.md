# PART 3: ADMIN CAPABILITIES + VENUE CAPABILITIES

---

# SECTION 4: ADMIN CAPABILITIES

## Admin Tools — Complete List

### 1. Admin Command Center (`/admin`)
- **Location**: `/admin` route
- **Access**: Admin role only (redirects non-admins to `/events`)
- **Functions**: 13-section dashboard:
  1. Live Issues — Active issues requiring attention
  2. Market Health — Marketplace health metrics
  3. Stripe / Payments — Payment diagnostics, capture failures, Stripe mode
  4. Instant Ops — Instant listing operations (no fulfillment workflow)
  5. AI Verification — AI proof verification queue with override capabilities
  6. Donations — Donation operations and management
  7. Alert Center — Admin alert queue (disputes, stalled transfers, etc.)
  8. Transfer Windows — Transfer window management
  9. Transfer Intelligence — Transfer verification intelligence
  10. Review Queue — Pending listing approval/rejection
  11. Fee Simulator — Fee calculation simulator and pricing strategy
  12. Flash Drops — Flash drop metrics
  13. Live Upgrades — Demo upgrade listing management
- **Data affected**: All entities (read via service role), Purchase, Listing (write via functions)
- **Risks**: No confirmation dialogs for destructive admin actions
- **Founder responsibilities**: Monitor daily for alerts, flagged purchases, pending reviews

### 2. Legacy Admin (`/admin-legacy`)
- **Location**: `/admin-legacy` route
- **Access**: Admin role only (same check as Command Center)
- **Functions**: Older admin interface (still accessible via link in Command Center top bar)
- **Data affected**: Same as Command Center
- **Risks**: Redundant with Command Center
- **Founder responsibilities**: Consider removing

### 3. Founder Dashboard (`/founder`)
- **Location**: `/founder` route
- **Access**: Admin role (no explicit role check in code — accessible by URL)
- **Functions**: High-level metrics, beta checklist, recruitment, dashboard
- **Data affected**: Read-only overview
- **Risks**: No admin gate — should be protected
- **Founder responsibilities**: Review daily

### 4. Beta Dashboard (`/beta-dashboard`)
- **Location**: `/beta-dashboard` route
- **Access**: No explicit role check (accessible by URL)
- **Functions**: Beta tester management
- **Data affected**: BetaTester, BetaFeedback, BetaFeedbackEvent
- **Risks**: No admin gate — should be protected
- **Founder responsibilities**: Review beta tester activity

### 5. Beta Recruitment (`/beta-testers`)
- **Location**: `/beta-testers` route
- **Access**: No explicit role check
- **Functions**: Beta tester recruitment
- **Data affected**: BetaTester
- **Risks**: No admin gate

### 6. Beta Checklist (`/beta-checklist`)
- **Location**: `/beta-checklist` route
- **Access**: No explicit role check
- **Functions**: Founder beta checklist
- **Data affected**: QAChecklistItem
- **Risks**: No admin gate

### 7. Leaderboard (`/leaderboard`)
- **Location**: `/leaderboard` route
- **Access**: All users
- **Functions**: Community leaderboard
- **Data affected**: User (read-only)
- **Risks**: None

### Hidden Admin Tools (Not in Bottom Navigation)

- **Event Lookup Debug Panel**: Shown on "Event not found" screens, gated behind `user?.role === 'admin'`
- **Live Upgrade Control Panel**: Within Admin Command Center → Live Upgrades section
- **Founder Event Nav Health Panel**: Within Founder Dashboard
- **Stripe Mode Diagnostic**: `getStripeMode` function (admin-only)
- **Seller Diagnostic**: `diagnoseSeller` function (authenticated, NO admin check — security issue)

### Admin Backend Functions (Complete List)

| Function | Purpose | Admin Gate |
|----------|---------|------------|
| `approveListingReview` | Approve pending listing | ✅ Admin role verified |
| `rejectListingReview` | Reject pending listing (requires reason) | ✅ Admin role verified |
| `adminOverrideAIVerification` | Override AI verification decision | ✅ Admin role verified |
| `releaseDemoUpgrades` | Manage demo upgrade listings | ✅ Admin role verified |
| `seedDemoListings` | Seed demo events and listings | ✅ Admin role verified |
| `getStripeMode` | Stripe key mode diagnostic | ✅ Admin role verified |
| `getStripeKey` | Returns publishable key | ❌ No admin check (intended for all users) |
| `diagnoseSeller` | Seller Stripe diagnostic | ❌ **NO admin check — security issue** |
| `processTransferReminders` | Scheduled reminders | Allows non-admin (for scheduler) |
| `processTransferAlerts` | Scheduled alerts | Allows non-admin (for scheduler) |
| `cleanupStaleDonations` | Scheduled donation cleanup | Allows non-admin (for scheduler) |

---

# SECTION 5: VENUE CAPABILITIES

## Venue Tools — Complete List

### Currently Existing Venue-Related Features

#### 1. Demo Venue Upgrade Listings
- **Location**: Admin Command Center → Live Upgrades section (`LiveUpgradeControlPanel`)
- **Permissions**: Admin only
- **Functions**:
  - **Release**: Creates 5 demo venue upgrade listings for a selected event (Floor A/B, Lower 101/105, Mid 201)
  - **Pause**: Hides all active demo venue upgrade listings
  - **Reset**: Deletes all demo venue upgrade listings for the event
  - **Reactivate**: Re-activates paused demo listings
- **Required setup**: None (demo mode)
- **Operational workflow**: Admin selects event → clicks "Release" → 5 demo upgrade listings created with `is_demo_listing: true`, `inventory_source: 'pg_demo'`, `requires_existing_ticket: true`, `requires_location: true`, `location_requirement: 'inside_venue'`

#### 2. Event Geo Coordinates
- **Location**: Event entity fields (`venue_lat`, `venue_lng`, `geo_radius_meters`)
- **Permissions**: Set by admin or TM sync (TM sync does NOT populate coordinates — must be manual)
- **Functions**: Used for Flash Drop and donation location verification
- **Required setup**: Must be manually set on events
- **Operational workflow**: Admin sets coordinates on Event entity → used by `seatDonation` opt_in action for geofencing

### Unfinished Venue Features

#### 1. Venue Partner Onboarding — DOES NOT EXIST
- No venue account creation
- No venue login/authentication
- No venue profile management
- No venue agreement/contract system

#### 2. Venue Dashboard — DOES NOT EXIST
- Venues have no interface to manage their listings
- No venue metrics view
- No venue notification system
- No venue ticket inventory management

#### 3. Venue Payout — DOES NOT EXIST
- No venue payout flow
- No venue revenue split
- No venue Stripe Connect integration
- No venue payment scheduling

#### 4. Real Geofencing — NOT IMPLEMENTED
- Browser geolocation used but no real geofencing enforcement
- No server-side location validation for upgrades
- No venue beacon integration
- No GPS accuracy enforcement
- In demo mode, location is entirely simulated

#### 5. Venue Map — NOT IMPLEMENTED
- No venue seat maps exist
- No interactive venue diagrams
- No section-level availability views

#### 6. Venue Ticket Release — DEMO ONLY
- Only demo mode exists via `releaseDemoUpgrades`
- No real venue ticket release flow
- No venue-to-platform ticket transfer system
- No real-time venue inventory sync

### Venue Features That Exist But Are Unfinished

| Feature/Field | Status | Notes |
|---------------|--------|-------|
| `inventory_source: 'venue_partner'` | Entity field exists | No code creates venue partner listings |
| `location_requirement: 'inside_venue'` | Field exists | Only used for demo listings |
| `upgrade_window_opens_at` / `upgrade_window_closes_at` | Fields exist | No code enforces time windows |
| `upgrade_instructions` | Field exists | Displayed after purchase, but only for demo listings |
| `transfer_window_status` on Event | Field exists | Mostly `unknown` — no automated checking |
| `transfer_window_source` | Field exists | Not automatically populated |
| `upgrade_eligibility_status` on Event | Field exists | Defaults to `unknown` |
| `is_beta_live` on Event | Field exists | Used for Live Hub eligibility but not venue-specific |

### What Would Need to Be Built for Real Venue Integration

1. **Venue Authentication System**: Venue-specific login, role (`venue_admin`), permissions
2. **Venue Onboarding Flow**: Agreement, bank account setup, venue profile
3. **Venue Dashboard**: Inventory management, listing creation, metrics, notifications
4. **Real Geofencing**: Server-side validation, venue beacon integration, GPS accuracy checks
5. **Venue Seat Maps**: Interactive venue diagrams with section-level availability
6. **Venue Ticket Release**: Real ticket release from venue inventory to marketplace
7. **Venue Payout System**: Revenue split, venue Stripe Connect, payment scheduling
8. **Venue Notification System**: Event-specific alerts to venue staff
9. **Venue Analytics**: Sales metrics, attendance tracking, upgrade conversion rates
10. **Venue API Integration**: Real-time inventory sync with venue ticketing systems
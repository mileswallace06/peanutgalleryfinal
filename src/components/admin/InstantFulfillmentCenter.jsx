/**
 * InstantFulfillmentCenter — main ops dashboard for Instant Listing fulfillment.
 * Replaces the old InstantListingsQueue with a full operational workflow.
 */
import { Zap, RefreshCw } from 'lucide-react';
import FulfillmentMetrics from './fulfillment/FulfillmentMetrics';
import FulfillmentQueue from './fulfillment/FulfillmentQueue';

export default function InstantFulfillmentCenter({ listings, purchases, events, user, onRefresh, loading }) {
  const instantListings = listings.filter(l => l.listing_mode === 'instant');

  // ── Bucket listings into sections ──
  const pendingVerification = instantListings.filter(
    l => l.custody_status === 'pending_pg_verification'
  );
  const verifiedInventory = instantListings.filter(
    l => l.custody_status === 'verified' && l.status === 'active'
  );
  const rejected = instantListings.filter(
    l => l.custody_status === 'rejected' || l.status === 'cancelled'
  );

  // ── Bucket purchases into sections ──
  const instantPurchases = purchases.filter(p => {
    const listing = listings.find(l => l.id === p.listing_id);
    return listing?.listing_mode === 'instant';
  });

  const soldAwaiting = instantPurchases.filter(
    p => p.transfer_status === 'pending_transfer' &&
         (!p.fulfillment_status || p.fulfillment_status === 'awaiting_pg_transfer' || p.fulfillment_status === 'transfer_in_progress') &&
         !p.seller_confirmed
  );
  const fulfilledAwaiting = instantPurchases.filter(
    p => p.transfer_status === 'pending_transfer' &&
         (p.fulfillment_status === 'fulfilled' || p.seller_confirmed) &&
         !p.buyer_confirmed
  );
  const completed = instantPurchases.filter(
    p => p.transfer_status === 'completed' || p.fulfillment_status === 'buyer_confirmed'
  );
  const issues = instantPurchases.filter(
    p => p.fulfillment_status === 'issue_reported' || p.transfer_status === 'disputed'
  );

  // Flatten events map
  const eventsMap = typeof events === 'object' && !Array.isArray(events) ? events : {};

  return (
    <div className="rounded-2xl overflow-hidden mb-6"
      style={{ border: '1px solid rgba(0,200,255,0.25)', background: 'rgba(0,200,255,0.03)' }}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(0,200,255,0.15)', background: 'rgba(0,200,255,0.06)' }}>
        <Zap className="w-5 h-5 flex-shrink-0" style={{ color: '#00C8FF' }} />
        <div className="flex-1">
          <h2 className="font-black text-base" style={{ color: '#00C8FF' }}>Instant Fulfillment Center</h2>
          <p className="text-[11px] text-muted-foreground">Custody verification · Inventory · Fulfillment ops</p>
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-5">
        {/* Analytics */}
        <FulfillmentMetrics listings={listings} purchases={instantPurchases} />

        {/* ── Issues first (most urgent) ── */}
        {issues.length > 0 && (
          <FulfillmentQueue
            title="Issues / Disputes"
            icon="🚨"
            items={issues}
            listings={listings}
            purchases={purchases}
            events={eventsMap}
            onRefresh={onRefresh}
            adminEmail={user?.email}
            defaultOpen={true}
            accentColor="#FF2D78"
          />
        )}

        {/* ── 1. Pending Custody Verification ── */}
        <FulfillmentQueue
          title="Pending Custody Verification"
          icon="🔍"
          items={pendingVerification}
          listings={listings}
          purchases={purchases}
          events={eventsMap}
          onRefresh={onRefresh}
          adminEmail={user?.email}
          defaultOpen={true}
          accentColor="#FF8C00"
        />

        {/* ── 2. Sold Awaiting Fulfillment ── */}
        <FulfillmentQueue
          title="Sold — Awaiting Fulfillment"
          icon="⚡"
          items={soldAwaiting}
          listings={listings}
          purchases={purchases}
          events={eventsMap}
          onRefresh={onRefresh}
          adminEmail={user?.email}
          defaultOpen={true}
          accentColor="#FF8C00"
        />

        {/* ── 3. Fulfilled Awaiting Buyer ── */}
        <FulfillmentQueue
          title="Fulfilled — Awaiting Buyer Confirm"
          icon="📨"
          items={fulfilledAwaiting}
          listings={listings}
          purchases={purchases}
          events={eventsMap}
          onRefresh={onRefresh}
          adminEmail={user?.email}
          defaultOpen={true}
          accentColor="#00C8FF"
        />

        {/* ── 4. Verified Inventory (live, not yet sold) ── */}
        <FulfillmentQueue
          title="Verified Inventory (Live)"
          icon="✅"
          items={verifiedInventory}
          listings={listings}
          purchases={purchases}
          events={eventsMap}
          onRefresh={onRefresh}
          adminEmail={user?.email}
          defaultOpen={false}
          accentColor="#00FF87"
        />

        {/* ── 5. Completed ── */}
        <FulfillmentQueue
          title="Completed Instant Orders"
          icon="🏁"
          items={completed}
          listings={listings}
          purchases={purchases}
          events={eventsMap}
          onRefresh={onRefresh}
          adminEmail={user?.email}
          defaultOpen={false}
          accentColor="#00FF87"
        />

        {/* ── 6. Rejected ── */}
        {rejected.length > 0 && (
          <FulfillmentQueue
            title="Rejected / Problem Listings"
            icon="🚫"
            items={rejected}
            listings={listings}
            purchases={purchases}
            events={eventsMap}
            onRefresh={onRefresh}
            adminEmail={user?.email}
            defaultOpen={false}
            accentColor="#FF2D78"
          />
        )}

        {instantListings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No instant listings yet. They'll appear here once sellers submit with the Instant Transfer mode.
          </p>
        )}
      </div>
    </div>
  );
}
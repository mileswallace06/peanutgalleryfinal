import { BadgeCheck, ArrowUpRight, FlameKindling } from 'lucide-react';

const TIER_COLORS = {
  floor: 'bg-purple-100 text-purple-700 border-purple-200',
  lower: 'bg-blue-100 text-blue-700 border-blue-200',
  mid: 'bg-green-100 text-green-700 border-green-200',
  upper: 'bg-amber-100 text-amber-700 border-amber-200',
};

export default function ListingCard({ listing, onUpgrade, isCheapest }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  return (
    <div className={`bg-white rounded-xl p-4 hover:shadow-lg transition-shadow flex flex-col gap-3 ${isCheapest ? 'border-2 border-primary' : 'border border-border'}`}>

      {/* Top badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCheapest && (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
            <FlameKindling className="w-3 h-3" /> Best Price
          </span>
        )}
        {listing.tier && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${TIER_COLORS[listing.tier] || 'bg-muted text-muted-foreground border-border'}`}>
            {listing.tier}
          </span>
        )}
        {isDemo ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            🥜 Demo Listing
          </span>
        ) : listing.proof_url ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
            <BadgeCheck className="w-3 h-3" /> Verified Transfer Info
          </span>
        ) : null}
      </div>

      {/* Seat info + price */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-foreground text-lg leading-tight">Section {listing.section}</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Row {listing.row}
            {listing.seats && <> · Seats {listing.seats}</>}
            {listing.quantity > 1 && <> · ×{listing.quantity} tickets</>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold text-foreground">${listing.asking_price}</div>
          {listing.original_price && (
            <div className="text-xs text-muted-foreground line-through">${listing.original_price}</div>
          )}
          {savings !== null && savings > 0 && (
            <div className="text-xs font-semibold text-green-600">{savings}% off</div>
          )}
          <div className="text-xs text-muted-foreground">per ticket</div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => onUpgrade(listing)}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-xl font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all"
      >
        <ArrowUpRight className="w-4 h-4" />
        Upgrade Now — ${listing.asking_price}
        {listing.quantity > 1 ? ` × ${listing.quantity}` : ''}
      </button>
    </div>
  );
}
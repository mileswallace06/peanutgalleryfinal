import { BadgeCheck, Tag, ArrowUp } from 'lucide-react';

const TIER_COLORS = {
  floor: 'bg-purple-100 text-purple-700',
  lower: 'bg-blue-100 text-blue-700',
  mid: 'bg-green-100 text-green-700',
  upper: 'bg-amber-100 text-amber-700',
};

export default function ListingCard({ listing, onUpgrade }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  return (
    <div className="bg-white border border-border rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-bold text-foreground text-lg">Section {listing.section}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">Row {listing.row}</span>
            {listing.seats && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm text-muted-foreground">Seats {listing.seats}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-2">
            {listing.tier && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${TIER_COLORS[listing.tier] || 'bg-muted text-muted-foreground'}`}>
                {listing.tier}
              </span>
            )}
            {isDemo ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                🥜 Beta Demo
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 flex items-center gap-1">
                <BadgeCheck className="w-3 h-3" /> Verified
              </span>
            )}
            {listing.quantity > 1 && (
              <span className="text-xs text-muted-foreground">×{listing.quantity} tickets</span>
            )}
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

      <div className="mt-4">
        <button
          onClick={() => onUpgrade(listing)}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          <ArrowUp className="w-4 h-4" />
          Upgrade Now
        </button>
      </div>
    </div>
  );
}
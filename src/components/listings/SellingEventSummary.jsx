import EventThumbnail from '@/components/events/EventThumbnail';
import { useEventClock } from '@/hooks/useEventClock';
import { sellingEventDate, sellingEventTiming, SELLING_STATUS_LABELS } from '@/lib/sellingEventTiming';
export default function SellingEventSummary({ event, onChange, disabled }) {
  const now = useEventClock();
  if (!event) return null;
  return <section aria-label="Selected event" className="rounded-2xl border border-border bg-card p-4 space-y-3">
    <div className="flex gap-3"><EventThumbnail event={event} className="w-16 h-20 rounded-xl flex-shrink-0" /><div className="min-w-0 space-y-1"><p className="text-xs font-bold text-primary">{SELLING_STATUS_LABELS[sellingEventTiming(event, now).status]}</p><h2 className="font-bold leading-snug">{event.title}</h2><p className="text-sm text-muted-foreground">{event.venue} · {[event.city, event.state].filter(Boolean).join(', ')}</p><p className="text-xs text-muted-foreground">{sellingEventDate(event, now)}</p></div></div>
    {onChange && <button type="button" onClick={onChange} disabled={disabled} className="min-h-11 text-sm font-bold text-primary disabled:opacity-50">Change event</button>}
  </section>;
}

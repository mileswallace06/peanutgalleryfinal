import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, XCircle, Circle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

const CHECKLIST = [
  { category: 'Auth / Login', items: ['Login flow completes', 'Session persists on reload', 'Me tab shows correct user', 'Logout works cleanly'] },
  { category: 'Seller Onboarding', items: ['Stripe Connect link opens', 'Onboarding completion detected', 'Payout account shows Active', 'Re-entry after partial setup'] },
  { category: 'Listing Creation', items: ['Event search returns results', 'City autocomplete works', 'Seat/price form validates', 'Photo upload succeeds', 'Listing appears in My Sales after submit'] },
  { category: 'Ticket Purchase', items: ['Listing card shows correct price', 'Purchase dialog opens', 'Stripe payment form renders', 'Payment succeeds end-to-end', 'Purchase appears in My Tickets'] },
  { category: 'Stripe Payments', items: ['Test card 4242 4242 accepted', 'Declined card shows error', 'Live key mode confirmed in Admin', 'PaymentIntent created in Stripe dashboard'] },
  { category: 'Escrow & Confirmation', items: ['Seller confirmation prompt works', 'Buyer confirmation prompt works', 'Payment captured after both confirm', 'Payout reflected in seller account'] },
  { category: 'Transfers', items: ['Platform transfer flow clear', 'Email transfer instructions shown', 'In-person transfer flow clear', 'Transfer proof upload works'] },
  { category: 'Location Services', items: ['Near Me button requests permission', 'GPS coordinates return correctly', 'Events load after location granted', 'Denied state shows fallback UI'] },
  { category: 'Search & Autocomplete', items: ['City autocomplete shows suggestions', 'Arrow key navigation works', 'Enter key selects result', 'Recent cities shown on focus'] },
  { category: 'Event Detail Pages', items: ['PG event detail loads', 'TM event detail loads', 'Listings display on event page', 'Event image renders'] },
  { category: 'Upgrades', items: ['Upgrades tab shows live events', 'Soon section shows correct window', 'Location-based filtering works', 'Upgrade listing card CTA works'] },
  { category: 'Fan Zone', items: ['Posts load correctly', 'Reaction emojis work', 'Seat Flex post creates', 'Bucket list search works'] },
  { category: 'Mobile Layout', items: ['Bottom nav renders correctly', 'No horizontal scroll overflow', 'Tap targets are large enough', 'Safe area insets respected (iPhone notch)'] },
  { category: 'Route & Navigation', items: ['Back button works from sub-pages', 'No nav tab highlights on sub-pages', 'Direct URL loads correctly', 'Me tab no longer flashes sign-in'] },
  { category: 'Error Handling', items: ['API failure shows error state', 'Empty state shown when no data', 'Form validation errors clear', 'Network offline gracefully handled'] },
  { category: 'Slow Network', items: ['Loaders appear during fetches', 'No blank screens during load', 'Retry buttons function', 'Data loads successfully after delay'] },
];

function ResultButton({ value, current, onSet, label, color }) {
  return (
    <button
      onClick={() => onSet(value)}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
      style={current === value
        ? { background: `${color}22`, color, border: `1px solid ${color}55` }
        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
      }
    >
      {value === 'pass' && <CheckCircle2 className="w-3 h-3" />}
      {value === 'fail' && <XCircle className="w-3 h-3" />}
      {value === 'untested' && <Circle className="w-3 h-3" />}
      {label}
    </button>
  );
}

export default function QAChecklist({ sessionId, testerName, device }) {
  const [results, setResults] = useState({});
  const [notes, setNotes] = useState({});
  const [openCategories, setOpenCategories] = useState({});
  const [saving, setSaving] = useState('');
  const [existingMap, setExistingMap] = useState({});

  useEffect(() => {
    if (!sessionId) return;
    base44.entities.QAChecklistItem.filter({ session_id: sessionId }).then(items => {
      const map = {};
      const r = {}, n = {};
      items.forEach(item => {
        map[item.title] = item;
        r[item.title] = item.result;
        n[item.title] = item.notes || '';
      });
      setExistingMap(map);
      setResults(r);
      setNotes(n);
    }).catch(() => {});
  }, [sessionId]);

  const setResult = async (category, title, value) => {
    const key = title;
    setResults(prev => ({ ...prev, [key]: value }));
    setSaving(key);
    const existing = existingMap[key];
    const payload = { category, title, result: value, notes: notes[key] || '', tester_name: testerName, device, session_id: sessionId };
    if (existing) {
      await base44.entities.QAChecklistItem.update(existing.id, { result: value });
    } else {
      const created = await base44.entities.QAChecklistItem.create(payload);
      setExistingMap(prev => ({ ...prev, [key]: created }));
    }
    setSaving('');
  };

  const saveNote = async (category, title) => {
    const key = title;
    setSaving(key + '_note');
    const existing = existingMap[key];
    if (existing) {
      await base44.entities.QAChecklistItem.update(existing.id, { notes: notes[key] || '' });
    } else {
      const created = await base44.entities.QAChecklistItem.create({ category, title, result: results[key] || 'untested', notes: notes[key] || '', tester_name: testerName, device, session_id: sessionId });
      setExistingMap(prev => ({ ...prev, [key]: created }));
    }
    setSaving('');
  };

  const totalItems = CHECKLIST.reduce((s, c) => s + c.items.length, 0);
  const passCount = Object.values(results).filter(r => r === 'pass').length;
  const failCount = Object.values(results).filter(r => r === 'fail').length;
  const pct = Math.round((passCount / totalItems) * 100);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-2xl" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-black text-muted-foreground">{passCount}/{totalItems} PASSED</span>
            <span className="text-xs font-black" style={{ color: pct === 100 ? '#00FF87' : failCount > 0 ? '#FF2D78' : '#BF5FFF' }}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: failCount > 0 ? '#FF2D78' : '#00FF87' }} />
          </div>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="font-bold" style={{ color: '#00FF87' }}>✓ {passCount}</span>
          <span className="font-bold" style={{ color: '#FF2D78' }}>✗ {failCount}</span>
          <span className="text-muted-foreground">{totalItems - passCount - failCount} untested</span>
        </div>
      </div>

      {/* Categories */}
      {CHECKLIST.map(({ category, items }) => {
        const catPass = items.filter(i => results[i] === 'pass').length;
        const catFail = items.filter(i => results[i] === 'fail').length;
        const isOpen = openCategories[category] !== false;
        const allPass = catPass === items.length;
        const hasFail = catFail > 0;

        return (
          <div key={category} className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: `1px solid ${hasFail ? 'rgba(255,45,120,0.3)' : allPass ? 'rgba(0,255,135,0.2)' : 'hsl(var(--border))'}` }}>
            <button
              onClick={() => setOpenCategories(prev => ({ ...prev, [category]: !isOpen }))}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              <div className="flex-1">
                <span className="text-sm font-bold text-foreground">{category}</span>
                <span className="ml-2 text-xs text-muted-foreground">{catPass}/{items.length}</span>
                {hasFail && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78' }}>{catFail} fail</span>}
                {allPass && <span className="ml-2 text-[10px] font-bold" style={{ color: '#00FF87' }}>✓ All passed</span>}
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {isOpen && (
              <div className="divide-y divide-border border-t border-border">
                {items.map(title => {
                  const r = results[title] || 'untested';
                  return (
                    <div key={title} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="flex-1 text-sm text-foreground">{title}</span>
                        {saving === title && <span className="text-[10px] text-muted-foreground">saving…</span>}
                        <div className="flex gap-1.5">
                          <ResultButton value="pass" current={r} onSet={v => setResult(category, title, v)} label="Pass" color="#00FF87" />
                          <ResultButton value="fail" current={r} onSet={v => setResult(category, title, v)} label="Fail" color="#FF2D78" />
                        </div>
                      </div>
                      {(r === 'fail' || notes[title]) && (
                        <div className="flex gap-2">
                          <input
                            value={notes[title] || ''}
                            onChange={e => setNotes(prev => ({ ...prev, [title]: e.target.value }))}
                            onBlur={() => saveNote(category, title)}
                            placeholder="Add notes…"
                            className="flex-1 text-xs px-3 py-1.5 rounded-xl focus:outline-none"
                            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
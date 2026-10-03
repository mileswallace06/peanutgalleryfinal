import { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function FaqAccordion({ items, accentColor = '#BF5FFF' }) {
  const [open, setOpen] = useState(null);
  const id = useId();
  const panels = useRef([]);

  return (
    <div className="space-y-2" role="list">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            role="listitem"
            className="rounded-lg overflow-hidden transition-all"
            style={{
              background: isOpen ? `color-mix(in srgb, ${accentColor} 5%, var(--pg-surface))` : 'var(--pg-surface)',
              border: `1px solid ${isOpen ? `color-mix(in srgb, ${accentColor} 40%, var(--pg-line))` : 'var(--pg-line)'}`,
            }}
          >
            <button
              type="button"
              onClick={event => {
                // If a panel containing focus is closed, keep focus on a visible control.
                if (panels.current[open]?.contains(document.activeElement)) event.currentTarget.focus();
                setOpen(isOpen ? null : i);
              }}
              aria-expanded={isOpen}
              aria-controls={`${id}-faq-body-${i}`}
              id={`${id}-faq-btn-${i}`}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
            >
              <span className="font-bold text-sm text-foreground leading-snug pr-2">{item.q}</span>
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                style={{ color: accentColor, transform: isOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            <div
              id={`${id}-faq-body-${i}`}
              ref={element => { panels.current[i] = element; }}
              hidden={!isOpen}
              role="region"
              aria-labelledby={`${id}-faq-btn-${i}`}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
                {item.a}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
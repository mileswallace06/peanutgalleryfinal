import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function FaqAccordion({ items, accentColor = '#BF5FFF' }) {
  const [open, setOpen] = useState(null);

  return (
    <div className="space-y-2" role="list">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            role="listitem"
            className="rounded-2xl overflow-hidden transition-all"
            style={{
              background: isOpen ? `${accentColor}08` : 'hsl(var(--card))',
              border: `1px solid ${isOpen ? accentColor + '35' : 'hsl(var(--border))'}`,
            }}
          >
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`faq-body-${i}`}
              id={`faq-btn-${i}`}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
            >
              <span className="font-bold text-sm text-foreground leading-snug pr-2">{item.q}</span>
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                style={{ color: accentColor, transform: isOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            <div
              id={`faq-body-${i}`}
              role="region"
              aria-labelledby={`faq-btn-${i}`}
              className="overflow-hidden transition-all duration-200"
              style={{ maxHeight: isOpen ? '600px' : '0', opacity: isOpen ? 1 : 0 }}
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
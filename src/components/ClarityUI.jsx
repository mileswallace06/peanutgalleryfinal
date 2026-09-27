import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import './clarity.css';

export function PageIntro({ eyebrow, title, description, backTo, backLabel = 'Back', action, children }) {
  return (
    <header className="pg-page-intro">
      {(backTo || action) && <div className="pg-page-intro-tools">
        {backTo && <Link to={backTo} className="pg-back-link"><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link>}
        {action}
      </div>}
      {eyebrow && <p className="pg-page-eyebrow">{eyebrow}</p>}
      <h1 className="pg-page-title font-display">{title}</h1>
      {description && <p className="pg-page-description">{description}</p>}
      {children}
    </header>
  );
}

export function Disclosure({ title, description, defaultOpen = false, children, className = '' }) {
  return (
    <details className={`pg-disclosure ${className}`} open={defaultOpen || undefined}>
      <summary>
        <span className="pg-disclosure-label"><span className="pg-disclosure-title">{title}</span>
          {description && <span className="pg-disclosure-description">{description}</span>}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="pg-disclosure-content">{children}</div>
    </details>
  );
}

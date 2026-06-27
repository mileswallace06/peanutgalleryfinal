import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { TOS_HTML } from '@/lib/tosHtml';

export default function TermsOfService() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-3 px-4 pb-3">
          <button onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Terms of Service</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto">
        {/* Render the Termly-generated TOS HTML */}
        <div dangerouslySetInnerHTML={{ __html: TOS_HTML }} />

        {/* Scoped styles to make the injected TOS content readable in both light & dark mode */}
        <style>{`
          [data-custom-class='body'] {
            color: hsl(var(--foreground));
            font-family: var(--font-sans);
            font-size: 14px;
            line-height: 1.7;
            word-break: break-word;
          }
          [data-custom-class='body'] * {
            color: hsl(var(--muted-foreground)) !important;
            background: transparent !important;
            border-color: hsl(var(--border)) !important;
          }
          [data-custom-class='title'],
          [data-custom-class='title'] *,
          [data-custom-class='heading_1'],
          [data-custom-class='heading_1'] *,
          [data-custom-class='heading_2'],
          [data-custom-class='heading_2'] * {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
            line-height: 1.3;
            margin-top: 1.8em;
            margin-bottom: 0.6em;
          }
          [data-custom-class='title'],
          [data-custom-class='title'] * {
            font-size: 1.6em !important;
            font-weight: 800;
          }
          [data-custom-class='heading_1'],
          [data-custom-class='heading_1'] * {
            font-size: 1.2em !important;
          }
          [data-custom-class='heading_2'],
          [data-custom-class='heading_2'] * {
            font-size: 1.1em !important;
          }
          [data-custom-class='title']:first-child,
          [data-custom-class='heading_1']:first-child,
          [data-custom-class='heading_2']:first-child {
            margin-top: 0;
          }
          [data-custom-class='body_text'] {
            margin: 0 0 1em 0;
            color: hsl(var(--muted-foreground)) !important;
          }
          [data-custom-class='body_text'] strong,
          [data-custom-class='body'] strong,
          [data-custom-class='body'] b {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
          }
          [data-custom-class='body'] a,
          [data-custom-class='link'],
          [data-custom-class='link'] * {
            color: var(--neon-cyan) !important;
            text-decoration: underline;
            word-break: break-all;
          }
          [data-custom-class='body'] a:hover {
            opacity: 0.8;
          }
          [data-custom-class='body'] ul,
          [data-custom-class='body'] ol {
            margin: 0 0 1em 0;
            padding-left: 1.5em;
            color: hsl(var(--muted-foreground));
          }
          [data-custom-class='body'] li {
            margin: 0.35em 0;
            color: hsl(var(--muted-foreground));
          }
          [data-custom-class='body'] li::marker {
            color: hsl(var(--muted-foreground));
          }
          [data-custom-class='body'] h1,
          [data-custom-class='body'] h2,
          [data-custom-class='body'] h3 {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
            line-height: 1.3;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
          }
          [data-custom-class='body'] h1 { font-size: 1.6em; font-weight: 800; }
          [data-custom-class='body'] h2 { font-size: 1.2em; }
          [data-custom-class='body'] h3 { font-size: 1.1em; }
          [data-custom-class='body'] h1:first-child,
          [data-custom-class='body'] h2:first-child,
          [data-custom-class='body'] h3:first-child {
            margin-top: 0;
          }
          [data-custom-class='body'] br {
            display: block;
            margin-top: 0.5em;
            content: "";
          }
          [data-custom-class='body'] > *:last-child {
            margin-bottom: 0;
          }
        `}</style>
      </div>
    </div>
  );
}
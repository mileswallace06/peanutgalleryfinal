import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  // Inject the Usercentrics Privacy Policy script into the page head.
  // The script renders the policy into any <div class="uc-privacy-policy"></div>.
  useEffect(() => {
    const existing = document.getElementById('usercentrics-ppg');
    if (existing) return;

    const script = document.createElement('script');
    script.id = 'usercentrics-ppg';
    script.setAttribute('privacy-policy-id', '9bec4d64-fe73-478c-861b-cba483ffd1a0');
    script.setAttribute('data-language', 'en');
    script.src = 'https://policygenerator.usercentrics.eu/api/privacy-policy';
    document.head.appendChild(script);

    return () => {
      const node = document.getElementById('usercentrics-ppg');
      if (node) node.remove();
    };
  }, []);

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
          <h1 className="font-display text-xl text-foreground">Privacy Policy</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto">
        {/* Usercentrics renders the policy here */}
        <div className="uc-privacy-policy" />

        {/* Scoped styles to make Usercentrics-injected content readable in both light & dark mode */}
        <style>{`
          .uc-privacy-policy {
            color: hsl(var(--foreground));
            font-family: var(--font-sans);
            font-size: 14px;
            line-height: 1.7;
            word-break: break-word;
          }
          .uc-privacy-policy * {
            color: hsl(var(--foreground)) !important;
            background: transparent !important;
            border-color: hsl(var(--border)) !important;
          }
          .uc-privacy-policy h1,
          .uc-privacy-policy h2,
          .uc-privacy-policy h3,
          .uc-privacy-policy h4,
          .uc-privacy-policy h5,
          .uc-privacy-policy h6 {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
            line-height: 1.3;
            margin-top: 1.8em;
            margin-bottom: 0.6em;
          }
          .uc-privacy-policy h1 { font-size: 1.6em; font-weight: 800; }
          .uc-privacy-policy h2 { font-size: 1.35em; }
          .uc-privacy-policy h3 { font-size: 1.15em; }
          .uc-privacy-policy h4 { font-size: 1.05em; }
          .uc-privacy-policy h5,
          .uc-privacy-policy h6 { font-size: 1em; }
          .uc-privacy-policy h1:first-child,
          .uc-privacy-policy h2:first-child,
          .uc-privacy-policy h3:first-child {
            margin-top: 0;
          }
          .uc-privacy-policy p {
            margin: 0 0 1em 0;
            color: hsl(var(--muted-foreground));
          }
          .uc-privacy-policy p strong,
          .uc-privacy-policy strong,
          .uc-privacy-policy b {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
          }
          .uc-privacy-policy a {
            color: var(--neon-cyan) !important;
            text-decoration: underline;
            word-break: break-all;
          }
          .uc-privacy-policy a:hover {
            opacity: 0.8;
          }
          .uc-privacy-policy ul,
          .uc-privacy-policy ol {
            margin: 0 0 1em 0;
            padding-left: 1.5em;
            color: hsl(var(--muted-foreground));
          }
          .uc-privacy-policy li {
            margin: 0.35em 0;
            color: hsl(var(--muted-foreground));
          }
          .uc-privacy-policy li::marker {
            color: hsl(var(--muted-foreground));
          }
          .uc-privacy-policy table {
            width: 100%;
            border-collapse: collapse;
            margin: 0 0 1.5em 0;
            font-size: 13px;
            table-layout: fixed;
            display: table;
          }
          .uc-privacy-policy thead {
            background: hsl(var(--muted)) !important;
          }
          .uc-privacy-policy th,
          .uc-privacy-policy td {
            border: 1px solid hsl(var(--border)) !important;
            padding: 10px 14px;
            text-align: left;
            vertical-align: top;
            white-space: normal !important;
            word-break: break-word;
            overflow-wrap: break-word;
          }
          .uc-privacy-policy th {
            color: hsl(var(--foreground)) !important;
            font-weight: 700;
            background: hsl(var(--muted)) !important;
          }
          .uc-privacy-policy td {
            color: hsl(var(--foreground)) !important;
          }
          .uc-privacy-policy tbody tr:nth-child(even) td {
            background: hsl(var(--muted) / 0.4) !important;
          }
          .uc-privacy-policy hr {
            border: none;
            border-top: 1px solid hsl(var(--border));
            margin: 1.5em 0;
          }
          .uc-privacy-policy blockquote {
            border-left: 3px solid hsl(var(--border));
            padding-left: 1em;
            margin: 0 0 1em 0;
            color: hsl(var(--muted-foreground));
          }
          .uc-privacy-policy img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
          }
          .uc-privacy-policy > *:last-child {
            margin-bottom: 0;
          }
        `}</style>
      </div>
    </div>
  );
}
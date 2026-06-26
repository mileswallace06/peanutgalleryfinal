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
      // Remove the script when leaving the page so it reloads fresh on next visit.
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

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto space-y-6 text-sm text-foreground leading-relaxed">
        {/* Usercentrics renders the policy here */}
        <div className="uc-privacy-policy" />
      </div>
    </div>
  );
}
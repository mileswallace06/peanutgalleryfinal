import { Loader2 } from 'lucide-react';

/**
 * Branded loading fallback for React.lazy Suspense boundaries.
 * Theme-aware — adapts to light/dark automatically.
 */
export default function RouteFallback() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-label="Loading page"
    >
      <img
        src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
        alt=""
        aria-hidden="true"
        className="h-14 w-auto rounded-2xl opacity-80"
      />
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );
}
import { Link } from 'react-router-dom';

export default function PGAuthShell({ title, description, children }) {
  return (
    <main className="h-[100dvh] overflow-y-auto overscroll-y-contain text-white"
      style={{ background: 'hsl(255 10% 5%)', WebkitOverflowScrolling: 'touch' }}>
      <div className="relative min-h-full isolate px-5"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
        <div className="absolute inset-0 -z-10 pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(180deg, rgba(5,3,12,0.65), rgba(5,3,12,0.94) 45%, #0D0B14), url(https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80)', backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        <div className="w-full max-w-md mx-auto">
          <Link to="/" className="inline-flex items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00FF87]">
            <img src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
              alt="" width="52" height="52" className="rounded-xl" />
            <span className="font-display text-xl">Peanut Gallery</span>
          </Link>
          <header className="mt-10 mb-7">
            <h1 className="font-display text-4xl leading-tight"
              style={{ color: '#00FF87', textShadow: '0 0 22px rgba(0,255,135,0.16)' }}>{title}</h1>
            <p className="mt-3 text-base leading-relaxed text-white/80">{description}</p>
          </header>
          {children}
          <footer className="mt-9 text-sm text-white/70 leading-relaxed">
            <p>By continuing, you agree to our <Link className="underline underline-offset-4 text-white" to="/terms">Terms of Service</Link> and <Link className="underline underline-offset-4 text-white" to="/privacy">Privacy Policy</Link>.</p>
            <Link to="/" className="inline-flex items-center min-h-11 mt-3 underline underline-offset-4 text-[#00C8FF]">Back to Peanut Gallery</Link>
          </footer>
        </div>
      </div>
    </main>
  );
}

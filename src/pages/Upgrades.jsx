import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, Zap, ChevronRight } from 'lucide-react';

export default function Upgrades() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    const now = Date.now();
    base44.entities.Event.list('date', 50).
    then((data) => {
      const eligible = data.filter((e) => e.status !== 'ended');
      // Upgrades tab = events that have already started
      setEvents(adminUnlocked ?
      eligible :
      eligible.filter((e) => e.date && now >= new Date(e.date).getTime())
      );
    }).
    catch(console.error).
    finally(() => setLoading(false));
  }, []);

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-52 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80"
          alt="Upgrades"
          className="w-full h-full object-cover object-top" />
        
        <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.4) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.95) 100%)' }} />

        <div className="absolute top-5 left-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full flex items-center gap-1.5"
          style={{ background: 'rgba(0,0,0,0.5)', color: '#00FF87', border: '1px solid #00FF8755', backdropFilter: 'blur(12px)' }}>
            ⚡ THE PEANUT GALLERY
          </span>
        </div>

        <div className="absolute bottom-5 left-4 right-4">
          <h1 className="font-display leading-[0.9] mb-3"
          style={{
            fontSize: 'clamp(3.2rem, 15vw, 5.2rem)',
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #00FF87 0%, #00C8FF 60%, #BF5FFF 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))'
          }}>
            Upgrades
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,255,135,0.15)', border: '1px solid rgba(0,255,135,0.35)' }}>
            <Zap className="w-3 h-3 flex-shrink-0" style={{ color: '#00FF87' }} />
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(210,255,235,0.9)' }}>
              Already at the show? Upgrade seats from fans around you — location-verified.
            </span>
          </div>
        </div>
      </div>

      {/* Event list */}
      <div className="px-4 mt-5">
        <p className="text-xs text-muted-foreground font-medium mb-3">
          {loading ? 'Loading...' : `${events.length} event${events.length !== 1 ? 's' : ''} with upgrades`}
        </p>

        {loading ?
        <div className="space-y-3">
            {[...Array(4)].map((_, i) =>
          <div key={i} className="rounded-2xl h-24 animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
          )}
          </div> :
        events.length === 0 ?
        <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">⚡</p>
            <p className="font-bold text-foreground">No live upgrades right now</p>
            <p className="text-sm text-muted-foreground mt-1">Check back once events go live.</p>
          </div> :

        <div className="space-y-3">
            {events.map((event) =>
          <Link
            key={event.id}
            to={`/upgrades/${event.id}`}
            className="flex items-center gap-3 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
              border: event.status === 'live' ? '1px solid rgba(0,255,135,0.25)' : '1px solid rgba(255,255,255,0.09)',
              boxShadow: event.status === 'live' ? '0 0 20px rgba(0,255,135,0.08)' : 'none'
            }}>
            
                {/* Thumbnail */}
                <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
                  {event.image_url ?
              <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" /> :

              <div className="w-full h-full absolute inset-0 flex items-center justify-center text-3xl"
              style={{ background: 'rgba(255,255,255,0.04)' }}>🎫</div>
              }
                  {event.status === 'live' &&
              <span className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: '#FF2D78', color: '#fff' }}>
                      LIVE
                    </span>
              }
                </div>

                {/* Info */}
                <div className="flex-1 py-3 min-w-0">
                  <h3 className="font-bold text-foreground text-sm leading-tight line-clamp-1">{event.title}</h3>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                    <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#00C8FF' }} />
                    <span className="truncate">{event.venue}{event.city ? `, ${event.city}` : ''}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
                    <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 mr-3 flex-shrink-0 text-muted-foreground" />
              </Link>
          )}
          </div>
        }
      </div>
    </div>);

}
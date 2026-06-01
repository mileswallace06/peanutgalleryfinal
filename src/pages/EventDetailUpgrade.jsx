/**
 * EventDetailUpgrade — Live Hub page for a specific event.
 * Route: /upgrades/:id
 * Three tabs: Flash Drops | Upgrades | Fan Karma
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import LiveHubHero from '@/components/eventmode/LiveHubHero';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import UpgradeFeed from '@/components/eventmode/UpgradeFeed';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';

const TABS = ['Upgrades', 'Flash Drops', 'Fan Karma'];

export default function EventDetailUpgrade() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [drops, setDrops] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Upgrades');
  const [showDropSheet, setShowDropSheet] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      base44.entities.Event.filter({ id }).catch(() => []),
      base44.entities.Listing.filter({ event_id: id, status: 'active' }).catch(() => []),
      base44.entities.FlashDrop.filter({ event_id: id }).catch(() => []),
      base44.auth.me().catch(() => null),
    ]).then(([events, listingData, dropData, me]) => {
      setEvent(events[0] || null);
      setListings(listingData);
      setDrops(dropData);
      setUser(me);
      setLoading(false);
    });
  }, [id]);

  const handleWinnerSelected = (dropId) => {
    setDrops(prev => prev.map(d => d.id === dropId ? { ...d, status: 'winner_selected' } : d));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <LiveHubHero event={event} listings={listings} drops={drops} />

      {/* Tab bar */}
      <div className="sticky top-0 z-20 flex border-b"
        style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-3 text-xs font-black tracking-wide uppercase transition-colors relative"
            style={{ color: activeTab === tab ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: 'hsl(var(--primary))' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-5 space-y-4">
        {activeTab === 'Upgrades' && (
          <UpgradeFeed listings={listings} eventId={id} loading={loading} />
        )}

        {activeTab === 'Flash Drops' && (
          <FlashDropCenter
            drops={drops}
            user={user}
            listings={listings}
            loading={loading}
            onDropSeats={() => setShowDropSheet(true)}
            onWinnerSelected={handleWinnerSelected}
          />
        )}

        {activeTab === 'Fan Karma' && (
          <FanKarmaCard eventId={id} user={user} />
        )}
      </div>

      {/* Flash Drop creation sheet */}
      {showDropSheet && event && (
        <CreateFlashDropSheet
          event={event}
          user={user}
          onClose={() => setShowDropSheet(false)}
          onCreated={(drop) => {
            setDrops(prev => [drop, ...prev]);
            setShowDropSheet(false);
          }}
        />
      )}
    </div>
  );
}
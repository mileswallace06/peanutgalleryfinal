import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { controls } from './base44';
import FanSortSheet from '@/components/fanzone/FanSortSheet';
import FanLocationFilter from '@/components/fanzone/FanLocationFilter';
import { useFanLocation } from '@/hooks/useFanLocation';
import { saveEventLocation } from '@/lib/eventLocation';
import '@/index.css';
import '@/pages/community-ticket.css';

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const config = window.__FAN_BEHAVIOR_CONFIG__ || {};
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: config.unavailable ? undefined : {
  getCurrentPosition(success, failure, options) { controls.gps.push({ success, failure, options }); },
} });
controls.resolveGPS = (index, latitude = 0, longitude = 0) => controls.gps[index].success({ coords: { latitude, longitude } });
controls.rejectGPS = (index, code) => controls.gps[index].failure({ code });
controls.resolveCityReads = () => controls.cityReads.splice(0).forEach(resolve => resolve());
controls.otherMarket = city => saveEventLocation(city);
window.fetch = () => Promise.reject(new Error('Fan fixture blocks fetch'));
XMLHttpRequest.prototype.open = () => { throw new Error('Fan fixture blocks XMLHttpRequest'); };
if (navigator.sendBeacon) navigator.sendBeacon = () => false;

function LocationHarness() {
  const state = useFanLocation();
  useEffect(() => { controls.location = { area: state.area, status: state.locationStatus }; }, [state.area, state.locationStatus]);
  return <><FanLocationFilter {...state} /><output aria-label="Location fixture state">{JSON.stringify({ area: state.area, status: state.locationStatus })}</output></>;
}
function Harness() {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState('upcoming');
  const [revision, setRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const trigger = useRef(null);
  useEffect(() => {
    controls.rerender = () => Promise.resolve().then(() => setRevision(value => value + 1));
    controls.mountLocation = setMounted;
    controls.originalTrigger = trigger.current;
  }, []);
  useEffect(() => { controls.revision = revision; }, [revision]);
  return <main className="pg-ticket-app pg-community-page" style={{ padding: 20, minHeight: '100vh' }}>
    <h1>Isolated Fan behavior</h1>
    <p>Fictional local fixture · revision {revision}</p>
    <button ref={trigger} className="pg-sort-control" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Sort posts. Current: ${sort}`} onClick={() => setOpen(true)}>Sort posts</button>
    {open && <FanSortSheet value={sort} allowDistance={false} onChange={setSort} onClose={() => setOpen(false)} triggerRef={trigger} />}
    {mounted && <LocationHarness />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);

import { cityFromSuggestion, validCoordinates } from '../../lib/eventLocation.js';

export function fanCoordinates(value) {
  const valid = validCoordinates(value);
  if (!valid) return null;
  const [lat, lng] = valid.split(',').map(Number);
  return { lat, lng };
}

export function fanDistanceKm(from, event) {
  if (!from || event?.venue_lat == null || event?.venue_lng == null) return null;
  const to = fanCoordinates(`${event.venue_lat},${event.venue_lng}`);
  if (!to) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(to.lat - from.lat) / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(radians(to.lng - from.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function nearbyFanPosts(posts, events, area) {
  const coordinates = fanCoordinates(area?.ll);
  const city = cityFromSuggestion(area);
  if (!coordinates && !city) return [];
  const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
  const eventById = new Map(events.map(event => [event.id, event]));
  return posts.filter(post => {
    const event = eventById.get(post.event_id);
    if (coordinates) {
      const distance = fanDistanceKm(coordinates, event);
      return distance !== null && distance <= 80;
    }
    // Never treat every city-tagged post as nearby, or conflate cities in different states.
    return equal(event?.city || post.event_city, city.city) && equal(event?.state || post.event_state, city.state);
  });
}

export function fanLocationMessage(status, area) {
  if (status === 'requesting') return 'Finding your location. You can choose a city while you wait.';
  if (status === 'denied') return 'Location access is blocked. Enable it in your browser’s site settings, then try again, or choose a city below.';
  if (status === 'timeout') return 'Your location request timed out. Try again or choose a city below.';
  if (status === 'unavailable') return 'Your location is unavailable. Try again or choose a city below.';
  if (area?.city) return `Showing posts for ${area.label || `${area.city}, ${area.state}`}.`;
  if (fanCoordinates(area?.ll)) return 'Showing posts within 80 km of your location.';
  return 'Choose a city or enable location to see nearby posts.';
}

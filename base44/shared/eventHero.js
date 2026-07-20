/**
 * Single source of truth for hero image resolution.
 *
 * Priority:
 *   1. Ticketmaster event artwork (event.image_url)
 *   2. Venue hero image (venue.hero_image)
 *   3. null  → the UI renders the GeneratedHero component (pure CSS, no API)
 *
 * The UI never displays an empty hero. This utility is used at sync time to
 * write Event.hero_image_url so reads need no join. Importable by backend
 * functions; the frontend renders hero_image_url directly and falls back to
 * GeneratedHero when it is empty.
 */

/**
 * Resolve the hero image URL for an event given its (optional) venue.
 * @param {{ image_url?: string } | null} event
 * @param {{ hero_image?: string } | null} [venue]
 * @returns {string | null}
 */
export function resolveEventHero(event, venue) {
  if (event?.image_url) return event.image_url;
  if (venue?.hero_image) return venue.hero_image;
  return null;
}

/**
 * True when no image source exists and the generated hero should render.
 * @param {{ image_url?: string } | null} event
 * @param {{ hero_image?: string } | null} [venue]
 * @returns {boolean}
 */
export function needsGeneratedHero(event, venue) {
  return resolveEventHero(event, venue) == null;
}
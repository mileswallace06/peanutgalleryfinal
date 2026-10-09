/** Load the current user's authorized participant view; no ownership claim. */
export async function loadEligibleFlashDropListings(client, eventId) {
  if (!eventId) throw new Error('Choose an event before checking your listings.');
  const response = await client.functions.invoke('getListingParticipantView', { action: 'list_mine' });
  const listings = response?.data?.listings;
  if (!Array.isArray(listings)) throw new Error('Your listings could not be checked.');
  return listings.filter(listing => listing.event_id === eventId && listing.status === 'active');
}

export function ownershipLookupMessage(status, count = 0) {
  if (status === 'loading') return 'Checking your active listings for this event…';
  if (status === 'empty') return 'No eligible active listings for this event were found in your loaded history. You can upload a ticket screenshot below instead. This does not confirm seat ownership.';
  if (status === 'populated') return `${count} active ${count === 1 ? 'listing found in your loaded history' : 'listings found in your loaded history'}. Choose the listing for these seats; final ownership checks still apply.`;
  if (status === 'error') return 'We could not check your listings. Please retry, or use the screenshot option below.';
  return '';
}

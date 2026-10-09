// Participant roles come only from the existing allowlisted endpoint. Never
// infer access from legacy Purchase emails, created_by, URL or caller state.
export function purchaseViewerRole(purchase, user) {
  if (purchase?.viewer_is_seller === true) return 'seller';
  if (purchase?.viewer_is_buyer === true) return 'buyer';
  return user?.role === 'admin' ? 'admin' : null;
}

export async function readAuthorizedPurchase(client, id) {
  const user = await client.auth.me();
  if (!user) return { status: 'signed-out', user: null, purchase: null };
  const response = await client.functions.invoke('getPurchaseParticipantView', { purchase_id: id });
  if (!response?.data || response.data.error || !Object.hasOwn(response.data, 'purchase')) throw new Error('Transaction response unavailable');
  const purchase = response?.data?.purchase;
  if (!purchase) return { status: 'unavailable', user, purchase: null };
  const role = purchaseViewerRole(purchase, user);
  if (purchase.id !== id || !role) return { status: 'unavailable', user, purchase: null };
  return { status: 'ready', purchase, user, role };
}

export async function readPurchaseContext(client, purchase, role) {
  const read = async (id, request) => {
    if (!id) return { status: 'missing', value: null };
    try {
      const value = await request();
      return { status: value ? 'ready' : 'missing', value: value || null };
    } catch (error) {
      return { status: (error?.response?.status || error?.status) === 404 ? 'missing' : 'error', value: null };
    }
  };
  const [event, listing, transfer] = await Promise.all([
    read(purchase.event_id, async () => {
      const rows = await client.entities.Event.filter({ id: purchase.event_id });
      if (!Array.isArray(rows)) throw new Error('Invalid event response');
      return rows.find(row => row.id === purchase.event_id);
    }),
    read(purchase.listing_id, async () => {
      const response = await client.functions.invoke('getListingParticipantView', { listing_id: purchase.listing_id });
      if (!response?.data || !Object.hasOwn(response.data, 'listing')) throw new Error('Invalid listing response');
      return response.data.listing?.id === purchase.listing_id ? response.data.listing : null;
    }),
    // Preserve the pre-existing pending-transfer UI's user-scoped fields only
    // after authoritative participant authorization. Completed history never
    // reads legacy private context merely to make sparse metadata look complete.
    // This dependency remains for the separate purchase-security workstream.
    read(purchase.transfer_status === 'pending_transfer' && ['seller', 'buyer'].includes(role) ? purchase.id : null, async () => {
      const rows = await client.entities.Purchase.filter({ id: purchase.id });
      if (!Array.isArray(rows)) throw new Error('Invalid transfer response');
      return rows.find(row => row.id === purchase.id);
    }),
  ]);
  return { event, listing, transfer };
}

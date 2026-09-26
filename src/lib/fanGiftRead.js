import { base44 } from '@/api/base44Client';

// Member screens consume only the server's limited view. Never fall back to
// raw FlashDrop rows when the function is unavailable or access is denied.
export async function loadFanGifts(eventId) {
  const response = await base44.functions.invoke('getFlashDropView', { event_id: eventId });
  const data = response?.data;
  if (!Array.isArray(data?.drops) || !Array.isArray(data?.leaders)) {
    throw new Error('Fan Gifts could not be loaded.');
  }
  return data;
}

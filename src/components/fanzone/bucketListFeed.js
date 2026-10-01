const normalize = value => String(value || '').trim().toLocaleLowerCase();

// Event metadata makes venue follows useful even when a post only names the show.
// A saved venue ID wins over a coincidentally matching name at another location.
export function filterBucketListPosts(posts, bucketList, events = []) {
  if (!bucketList.length) return [];
  const eventById = new Map(events.map(event => [event.id, event]));
  return posts.filter(post => {
    const event = eventById.get(post.event_id);
    return bucketList.some(item => {
      if (item.type === 'venue' && item.tm_id && event?.tm_venue_id) {
        return item.tm_id === event.tm_venue_id;
      }
      const name = normalize(item.name);
      if (!name) return false;
      const fields = [post.event_title, post.text, event?.title, event?.artist];
      if (item.type === 'venue') fields.push(event?.venue);
      return fields.some(value => normalize(value).includes(name));
    });
  });
}

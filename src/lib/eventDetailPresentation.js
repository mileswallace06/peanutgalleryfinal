const EVENT_MODE_COPY = Object.freeze({
  live: Object.freeze({
    title: 'Live Hub — Open Now!',
    description: 'Flash Drops, seat upgrades & live fan activity',
    action: 'Open →',
  }),
  soon: Object.freeze({
    title: 'Live Hub — Starting Soon',
    description: 'Flash Drops & upgrades open when the event starts',
    action: 'Get Ready',
  }),
  upcoming: Object.freeze({
    title: 'Upgrades & Live Hub',
    description: 'Flash Drops & upgrades unlock at showtime',
    action: 'Preview',
  }),
  ended: Object.freeze({
    title: 'Event has ended',
    description: 'Live ticket and upgrade activity is closed',
    action: 'View status',
  }),
});

/**
 * Keep time-sensitive Event Detail promises tied to the calculated event state.
 * Unknown values intentionally use the conservative upcoming presentation.
 */
export function getEventModeCopy(status) {
  return EVENT_MODE_COPY[status] || EVENT_MODE_COPY.upcoming;
}

export function getEmptyTicketCopy(status) {
  if (status === 'ended') {
    return {
      title: 'Ticket sales have closed',
      description: 'This event has ended, so ticket sales and live seat upgrades are no longer available.',
      action: 'Browse other events',
      destination: '/events',
    };
  }

  if (status === 'live') {
    return {
      title: 'Event is live — check Upgrades',
      description: 'Pre-event ticket sales have closed. Fans inside may be listing seat upgrades now.',
      action: 'Find Seat Upgrades',
      destination: null,
    };
  }

  return null;
}

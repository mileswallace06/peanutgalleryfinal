import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const keyword = body.keyword || '';
    const size = body.size || 20;
    const latlong = body.latlong || ''; // e.g. "33.4484,-112.0740"
    const radius = body.radius || '50'; // miles
    const city = body.city || ''; // city name or zip

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'Ticketmaster API key not configured' }, { status: 500 });
    }

    // Use caller-supplied local date string (YYYY-MM-DD) if provided, else fall back to UTC now.
    // This ensures we filter by venue-local "today" rather than UTC midnight.
    const localDate = body.localDate || ''; // e.g. "2026-05-08"
    const startDateTime = localDate
      ? `${localDate}T00:00:00Z`
      : new Date().toISOString().split('.')[0] + 'Z';

    const params = new URLSearchParams({
      apikey: apiKey,
      size: String(size),
      sort: 'date,asc',
      startDateTime,
      countryCode: 'US',
    });

    if (keyword) params.set('keyword', keyword);
    if (latlong) {
      params.set('latlong', latlong);
      params.set('radius', String(radius));
      params.set('unit', 'miles');
    } else if (city) {
      params.set('city', city);
    }

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
    const res = await fetch(url);
    const data = await res.json();

    const rawEvents = data?._embedded?.events || [];

    const events = rawEvents.map(e => {
      const venue = e._embedded?.venues?.[0];
      const image = e.images?.find(i => i.ratio === '16_9' && i.width >= 640) || e.images?.[0];
      const dateInfo = e.dates?.start;

      // Prefer localDate+localTime (venue-timezone-aware) over UTC dateTime to avoid TZ skew.
      // Store as a plain local datetime string so the browser doesn't shift it.
      const localDateStr = dateInfo?.localDate
        ? `${dateInfo.localDate}T${dateInfo.localTime || '00:00:00'}`
        : dateInfo?.dateTime || null;

      return {
        tm_id: e.id,
        title: e.name,
        date: localDateStr,
        venue: venue?.name || '',
        city: venue?.city?.name || '',
        state: venue?.state?.stateCode || '',
        image_url: image?.url || '',
        tm_url: e.url || '',
        source: 'ticketmaster',
        local_date: dateInfo?.localDate || null, // YYYY-MM-DD in venue tz
      };
    });

    return Response.json({ events });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
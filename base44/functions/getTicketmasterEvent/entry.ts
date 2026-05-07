import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const tmId = body.tm_id;

    if (!tmId) {
      return Response.json({ error: 'tm_id is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'Ticketmaster API key not configured' }, { status: 500 });
    }

    const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(tmId)}.json?apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || data.fault || !data.id) {
      return Response.json({ event: null });
    }

    const venue = data._embedded?.venues?.[0];
    const image = data.images?.find(i => i.ratio === '16_9' && i.width >= 640) || data.images?.[0];
    const dateInfo = data.dates?.start;

    const event = {
      tm_id: data.id,
      title: data.name,
      date: dateInfo?.dateTime || (dateInfo?.localDate ? `${dateInfo.localDate}T${dateInfo.localTime || '00:00:00'}` : null),
      venue: venue?.name || '',
      city: venue?.city?.name || '',
      state: venue?.state?.stateCode || '',
      image_url: image?.url || '',
      tm_url: data.url || '',
      source: 'ticketmaster',
    };

    return Response.json({ event });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
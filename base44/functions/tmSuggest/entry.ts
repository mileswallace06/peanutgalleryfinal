import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { keyword } = await req.json();
    if (!keyword || keyword.trim().length < 2) return Response.json({ attractions: [], venues: [] });

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) return Response.json({ error: 'Missing TM API key' }, { status: 500 });

    const q = encodeURIComponent(keyword.trim());

    // Fetch attractions (artists, bands, teams) and venues in parallel
    const [attractRes, venueRes] = await Promise.all([
      fetch(`https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=${q}&size=6&apikey=${apiKey}`),
      fetch(`https://app.ticketmaster.com/discovery/v2/venues.json?keyword=${q}&size=4&apikey=${apiKey}&countryCode=US`),
    ]);

    const [attractData, venueData] = await Promise.all([attractRes.json(), venueRes.json()]);

    const attractions = (attractData?._embedded?.attractions || []).map(a => ({
      tm_id: a.id,
      name: a.name,
      type: 'attraction',
      image_url: a.images?.find(i => i.ratio === '16_9' && i.width >= 300)?.url || a.images?.[0]?.url || null,
      genre: a.classifications?.[0]?.genre?.name || a.classifications?.[0]?.segment?.name || null,
    }));

    const venues = (venueData?._embedded?.venues || []).map(v => ({
      tm_id: v.id,
      name: v.name,
      type: 'venue',
      image_url: v.images?.find(i => i.ratio === '16_9')?.url || v.images?.[0]?.url || null,
      genre: [v.city?.name, v.state?.stateCode].filter(Boolean).join(', ') || null,
    }));

    return Response.json({ attractions, venues });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
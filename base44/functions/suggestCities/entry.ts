import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { keyword } = await req.json();
    if (!keyword || keyword.trim().length < 2) return Response.json({ cities: [] });

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) return Response.json({ cities: [] });

    const q = encodeURIComponent(keyword.trim());
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/venues.json?keyword=${q}&size=10&countryCode=US&apikey=${apiKey}`
    );
    const data = await res.json();

    const venues = data?._embedded?.venues || [];

    // Deduplicate by "City, State" key
    const seen = new Set();
    const cities = [];
    for (const v of venues) {
      const city = v.city?.name;
      const state = v.state?.stateCode || v.state?.name;
      const country = v.country?.countryCode;
      if (!city) continue;
      const label = state ? `${city}, ${state}` : country ? `${city}, ${country}` : city;
      if (seen.has(label)) continue;
      seen.add(label);
      cities.push({ city, state: state || null, country: country || null, label });
    }

    return Response.json({ cities });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
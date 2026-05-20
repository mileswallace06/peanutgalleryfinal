import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Top ~300 US cities for instant prefix matching without API calls
const US_CITIES = [
  { city: 'New York', state: 'NY' }, { city: 'Los Angeles', state: 'CA' },
  { city: 'Chicago', state: 'IL' }, { city: 'Houston', state: 'TX' },
  { city: 'Phoenix', state: 'AZ' }, { city: 'Philadelphia', state: 'PA' },
  { city: 'San Antonio', state: 'TX' }, { city: 'San Diego', state: 'CA' },
  { city: 'Dallas', state: 'TX' }, { city: 'San Jose', state: 'CA' },
  { city: 'Austin', state: 'TX' }, { city: 'Jacksonville', state: 'FL' },
  { city: 'Fort Worth', state: 'TX' }, { city: 'Columbus', state: 'OH' },
  { city: 'Charlotte', state: 'NC' }, { city: 'Indianapolis', state: 'IN' },
  { city: 'San Francisco', state: 'CA' }, { city: 'Seattle', state: 'WA' },
  { city: 'Denver', state: 'CO' }, { city: 'Nashville', state: 'TN' },
  { city: 'Oklahoma City', state: 'OK' }, { city: 'El Paso', state: 'TX' },
  { city: 'Washington', state: 'DC' }, { city: 'Las Vegas', state: 'NV' },
  { city: 'Louisville', state: 'KY' }, { city: 'Memphis', state: 'TN' },
  { city: 'Portland', state: 'OR' }, { city: 'Baltimore', state: 'MD' },
  { city: 'Milwaukee', state: 'WI' }, { city: 'Albuquerque', state: 'NM' },
  { city: 'Tucson', state: 'AZ' }, { city: 'Fresno', state: 'CA' },
  { city: 'Mesa', state: 'AZ' }, { city: 'Sacramento', state: 'CA' },
  { city: 'Atlanta', state: 'GA' }, { city: 'Kansas City', state: 'MO' },
  { city: 'Omaha', state: 'NE' }, { city: 'Colorado Springs', state: 'CO' },
  { city: 'Raleigh', state: 'NC' }, { city: 'Long Beach', state: 'CA' },
  { city: 'Virginia Beach', state: 'VA' }, { city: 'Minneapolis', state: 'MN' },
  { city: 'Tampa', state: 'FL' }, { city: 'New Orleans', state: 'LA' },
  { city: 'Arlington', state: 'TX' }, { city: 'Bakersfield', state: 'CA' },
  { city: 'Honolulu', state: 'HI' }, { city: 'Anaheim', state: 'CA' },
  { city: 'Aurora', state: 'CO' }, { city: 'Santa Ana', state: 'CA' },
  { city: 'Corpus Christi', state: 'TX' }, { city: 'Riverside', state: 'CA' },
  { city: 'Lexington', state: 'KY' }, { city: 'St. Louis', state: 'MO' },
  { city: 'Pittsburgh', state: 'PA' }, { city: 'Stockton', state: 'CA' },
  { city: 'Anchorage', state: 'AK' }, { city: 'Cincinnati', state: 'OH' },
  { city: 'St. Paul', state: 'MN' }, { city: 'Greensboro', state: 'NC' },
  { city: 'Toledo', state: 'OH' }, { city: 'Newark', state: 'NJ' },
  { city: 'Plano', state: 'TX' }, { city: 'Henderson', state: 'NV' },
  { city: 'Lincoln', state: 'NE' }, { city: 'Buffalo', state: 'NY' },
  { city: 'Fort Wayne', state: 'IN' }, { city: 'Jersey City', state: 'NJ' },
  { city: 'Chula Vista', state: 'CA' }, { city: 'Orlando', state: 'FL' },
  { city: 'St. Petersburg', state: 'FL' }, { city: 'Norfolk', state: 'VA' },
  { city: 'Chandler', state: 'AZ' }, { city: 'Laredo', state: 'TX' },
  { city: 'Madison', state: 'WI' }, { city: 'Durham', state: 'NC' },
  { city: 'Lubbock', state: 'TX' }, { city: 'Winston-Salem', state: 'NC' },
  { city: 'Garland', state: 'TX' }, { city: 'Glendale', state: 'AZ' },
  { city: 'Hialeah', state: 'FL' }, { city: 'Reno', state: 'NV' },
  { city: 'Baton Rouge', state: 'LA' }, { city: 'Irvine', state: 'CA' },
  { city: 'Chesapeake', state: 'VA' }, { city: 'Irving', state: 'TX' },
  { city: 'Scottsdale', state: 'AZ' }, { city: 'North Las Vegas', state: 'NV' },
  { city: 'Fremont', state: 'CA' }, { city: 'Gilbert', state: 'AZ' },
  { city: 'San Bernardino', state: 'CA' }, { city: 'Birmingham', state: 'AL' },
  { city: 'Rochester', state: 'NY' }, { city: 'Richmond', state: 'VA' },
  { city: 'Spokane', state: 'WA' }, { city: 'Des Moines', state: 'IA' },
  { city: 'Montgomery', state: 'AL' }, { city: 'Modesto', state: 'CA' },
  { city: 'Fayetteville', state: 'NC' }, { city: 'Tacoma', state: 'WA' },
  { city: 'Shreveport', state: 'LA' }, { city: 'Fontana', state: 'CA' },
  { city: 'Moreno Valley', state: 'CA' }, { city: 'Glendale', state: 'CA' },
  { city: 'Akron', state: 'OH' }, { city: 'Yonkers', state: 'NY' },
  { city: 'Huntington Beach', state: 'CA' }, { city: 'Little Rock', state: 'AR' },
  { city: 'Columbus', state: 'GA' }, { city: 'Augusta', state: 'GA' },
  { city: 'Grand Rapids', state: 'MI' }, { city: 'Oxnard', state: 'CA' },
  { city: 'Tallahassee', state: 'FL' }, { city: 'Huntsville', state: 'AL' },
  { city: 'Worcester', state: 'MA' }, { city: 'Knoxville', state: 'TN' },
  { city: 'Newport News', state: 'VA' }, { city: 'Providence', state: 'RI' },
  { city: 'Tempe', state: 'AZ' }, { city: 'Brownsville', state: 'TX' },
  { city: 'Santa Clarita', state: 'CA' }, { city: 'Garden Grove', state: 'CA' },
  { city: 'Oceanside', state: 'CA' }, { city: 'Chattanooga', state: 'TN' },
  { city: 'Fort Lauderdale', state: 'FL' }, { city: 'Rancho Cucamonga', state: 'CA' },
  { city: 'Santa Rosa', state: 'CA' }, { city: 'Salt Lake City', state: 'UT' },
  { city: 'Peoria', state: 'AZ' }, { city: 'Vancouver', state: 'WA' },
  { city: 'Cape Coral', state: 'FL' }, { city: 'Sioux Falls', state: 'SD' },
  { city: 'Ontario', state: 'CA' }, { city: 'Jackson', state: 'MS' },
  { city: 'Elk Grove', state: 'CA' }, { city: 'Clarksville', state: 'TN' },
  { city: 'Pembroke Pines', state: 'FL' }, { city: 'Eugene', state: 'OR' },
  { city: 'Salem', state: 'OR' }, { city: 'Corona', state: 'CA' },
  { city: 'Fort Collins', state: 'CO' }, { city: 'McKinney', state: 'TX' },
  { city: 'Lancaster', state: 'CA' }, { city: 'Cary', state: 'NC' },
  { city: 'Palmdale', state: 'CA' }, { city: 'Hayward', state: 'CA' },
  { city: 'Salinas', state: 'CA' }, { city: 'Sunnyvale', state: 'CA' },
  { city: 'Pomona', state: 'CA' }, { city: 'Escondido', state: 'CA' },
  { city: 'Kansas City', state: 'KS' }, { city: 'Torrance', state: 'CA' },
  { city: 'Bridgeport', state: 'CT' }, { city: 'Alexandria', state: 'VA' },
  { city: 'Roseville', state: 'CA' }, { city: 'Joliet', state: 'IL' },
  { city: 'Hollywood', state: 'FL' }, { city: 'Paterson', state: 'NJ' },
  { city: 'Savannah', state: 'GA' }, { city: 'Syracuse', state: 'NY' },
  { city: 'Torrance', state: 'CA' }, { city: 'Pasadena', state: 'TX' },
  { city: 'Pasadena', state: 'CA' }, { city: 'Macon', state: 'GA' },
  { city: 'Mesquite', state: 'TX' }, { city: 'Dayton', state: 'OH' },
  { city: 'Sunnyvale', state: 'CA' }, { city: 'Hampton', state: 'VA' },
  { city: 'Lakewood', state: 'CO' }, { city: 'Killeen', state: 'TX' },
  { city: 'Springfield', state: 'MO' }, { city: 'Warren', state: 'MI' },
  { city: 'Columbia', state: 'SC' }, { city: 'Waco', state: 'TX' },
  { city: 'Bellevue', state: 'WA' }, { city: 'New Haven', state: 'CT' },
  { city: 'Miramar', state: 'FL' }, { city: 'Thousand Oaks', state: 'CA' },
  { city: 'Sterling Heights', state: 'MI' }, { city: 'Surprise', state: 'AZ' },
  { city: 'Metairie', state: 'LA' }, { city: 'Roseville', state: 'CA' },
  { city: 'Charleston', state: 'SC' }, { city: 'Visalia', state: 'CA' },
  { city: 'Cedar Rapids', state: 'IA' }, { city: 'Coral Springs', state: 'FL' },
  { city: 'Topeka', state: 'KS' }, { city: 'Stamford', state: 'CT' },
  { city: 'Concord', state: 'CA' }, { city: 'Hartford', state: 'CT' },
  { city: 'Roseville', state: 'CA' }, { city: 'Elizabeth', state: 'NJ' },
  { city: 'Rockford', state: 'IL' }, { city: 'Surprise', state: 'AZ' },
  { city: 'Gainesville', state: 'FL' }, { city: 'Hollywood', state: 'CA' },
  { city: 'Peoria', state: 'IL' }, { city: 'Scottsdale', state: 'AZ' },
  { city: 'Overland Park', state: 'KS' }, { city: 'Tempe', state: 'AZ' },
  { city: 'Ontario', state: 'CA' }, { city: 'Brownsville', state: 'TX' },
  { city: 'Santa Ana', state: 'CA' }, { city: 'Anaheim', state: 'CA' },
  // More well-known cities/venues
  { city: 'Miami', state: 'FL' }, { city: 'Boston', state: 'MA' },
  { city: 'Detroit', state: 'MI' }, { city: 'Minneapolis', state: 'MN' },
  { city: 'Cleveland', state: 'OH' }, { city: 'Denver', state: 'CO' },
  { city: 'Portland', state: 'OR' }, { city: 'Phoenix', state: 'AZ' },
  { city: 'San Jose', state: 'CA' }, { city: 'San Francisco', state: 'CA' },
  { city: 'Oakland', state: 'CA' }, { city: 'Newark', state: 'NJ' },
  { city: 'Jersey City', state: 'NJ' }, { city: 'Hartford', state: 'CT' },
  { city: 'Providence', state: 'RI' }, { city: 'New Haven', state: 'CT' },
  { city: 'Albany', state: 'NY' }, { city: 'Trenton', state: 'NJ' },
  { city: 'Allentown', state: 'PA' }, { city: 'Erie', state: 'PA' },
  { city: 'Reading', state: 'PA' }, { city: 'Scranton', state: 'PA' },
  { city: 'Harrisburg', state: 'PA' }, { city: 'Altoona', state: 'PA' },
  { city: 'York', state: 'PA' }, { city: 'State College', state: 'PA' },
  { city: 'Bethlehem', state: 'PA' }, { city: 'Lancaster', state: 'PA' },
  { city: 'Wilmington', state: 'DE' }, { city: 'Dover', state: 'DE' },
  { city: 'Annapolis', state: 'MD' }, { city: 'Frederick', state: 'MD' },
  { city: 'Hagerstown', state: 'MD' }, { city: 'Gaithersburg', state: 'MD' },
  { city: 'Rockville', state: 'MD' }, { city: 'Columbia', state: 'MD' },
  { city: 'Bowie', state: 'MD' }, { city: 'Towson', state: 'MD' },
  { city: 'Aberdeen', state: 'MD' }, { city: 'Salisbury', state: 'MD' },
].filter((v, i, arr) => arr.findIndex(x => x.city === v.city && x.state === v.state) === i);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { keyword } = await req.json();
    if (!keyword || keyword.trim().length < 2) return Response.json({ cities: [] });

    const kw = keyword.trim().toLowerCase();

    // 1. Local list: instant prefix match (city name starts with keyword)
    const localMatches = US_CITIES
      .filter(c => c.city.toLowerCase().startsWith(kw))
      .slice(0, 4)
      .map(c => ({ city: c.city, state: c.state, country: 'US', label: `${c.city}, ${c.state}` }));

    // 2. If we have any local matches, return immediately (no API call needed)
    if (localMatches.length >= 1) {
      console.log('[suggestCities] local matches:', localMatches.map(c => c.label));
      return Response.json({ cities: localMatches });
    }

    // 3. Supplement with Ticketmaster city search for partial matches
    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    let tmCities = [];
    if (apiKey) {
      try {
        const q = encodeURIComponent(keyword.trim());
        const res = await fetch(
          `https://app.ticketmaster.com/discovery/v2/venues.json?city=${q}&size=10&countryCode=US&apikey=${apiKey}`
        );
        const data = await res.json();
        const venues = data?._embedded?.venues || [];
        const seen = new Set(localMatches.map(c => c.label));
        for (const v of venues) {
          const city = v.city?.name;
          const state = v.state?.stateCode || v.state?.name;
          if (!city || !state) continue;
          const label = `${city}, ${state}`;
          if (seen.has(label)) continue;
          seen.add(label);
          tmCities.push({ city, state, country: 'US', label });
          if (tmCities.length >= 2) break;
        }
      } catch (_) { /* TM failure is non-fatal */ }
    }

    const cities = [...localMatches, ...tmCities].slice(0, 6);
    console.log('[suggestCities] keyword:', keyword, '→', cities.map(c => c.label));
    return Response.json({ cities });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
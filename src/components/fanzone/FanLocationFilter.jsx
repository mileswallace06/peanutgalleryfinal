import { useState } from 'react';
import { MapPin } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { fanLocationMessage } from './fanNearby';

export default function FanLocationFilter({ area, locationStatus, chooseCity, enableLocation }) {
  const [cityInput, setCityInput] = useState('');
  const [cityError, setCityError] = useState('');
  return <section className="pg-fan-location" aria-label="Nearby post location">
    <p role="status"><MapPin size={15} aria-hidden="true" />{fanLocationMessage(locationStatus, area)}</p>
    {area && locationStatus !== 'idle' && locationStatus !== 'granted' && <p className="pg-fan-location-current">Your feed still uses {area.city ? area.label : 'your previously selected location'}.</p>}
    <button type="button" className="pg-fan-location-enable" onClick={enableLocation} disabled={locationStatus === 'requesting'}>
      {locationStatus === 'requesting' ? 'Locating…' : ['denied', 'timeout', 'unavailable'].includes(locationStatus) ? 'Try location again' : 'Enable location'}
    </button>
    <p className="pg-fan-location-label">Or choose a city</p>
    <LocationAutocomplete value={cityInput} placeholder="Search city for nearby posts"
      onChange={value => { setCityInput(value); setCityError(''); }}
      onSelect={suggestion => { setCityError(chooseCity(suggestion) ? '' : 'Choose a city from the suggestions.'); }}
      onSubmit={() => setCityError('Choose a city from the suggestions to update nearby posts.')} />
    {cityError && <p role="alert">{cityError}</p>}
    {area && <p className="pg-fan-location-note">Nearby posts use the location details of loaded events.</p>}
  </section>;
}

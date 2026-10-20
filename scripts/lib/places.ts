// Shared by fetch-wikipedia-places and build-data: how a city name becomes a lookup key,
// so both scripts agree on which city they mean.
import { clean } from './wikipedia.ts';

// "Montgomery(Selma)" → "Montgomery"; "Sneedville–Johnson City" → "Sneedville".
export const firstCity = (s: string) => clean(s).split(/[(/–—;]|\band\b/)[0].replace(/,.*$/, '').trim();

// "Seattle|WA"
export const placeKey = (city: string, stateCode: string) => `${firstCity(city)}|${stateCode}`;

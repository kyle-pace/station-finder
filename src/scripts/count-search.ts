// Anonymous search count (SPEC section 8), shared by the results page and the as-you-type
// dropdown: input type, result bucket, and only a ZIP's first 3 digits or a state code.
// Never the search text. "Use my location" searches aren't counted.

import { looksLikeCallSign, type Search } from '../lib/search-core';
import { STATE_NAMES } from '../lib/states';
import { count } from './count';

export function countSearch(q: string, r: Search): void {
  if (r.kind === 'near') return;
  const n = r.kind === 'zip-unknown' ? 0 : r.results.length;
  const results = n === 0 ? 'none' : n <= 3 ? '1-3' : '4+';
  const stateCode = Object.entries(STATE_NAMES).find(([code, name]) => code === q.toUpperCase() || name.toLowerCase() === q.toLowerCase())?.[0];
  const fields = r.kind === 'zip' || r.kind === 'zip-unknown' ? { input_type: 'zip', area: r.zip.slice(0, 3) }
    : looksLikeCallSign(q) ? { input_type: 'callsign', area: '' }
    : stateCode ? { input_type: 'state', area: stateCode }
    : { input_type: 'name', area: '' };
  count('search', { ...fields, results });
  if (n === 0) count('no_results', fields);
}

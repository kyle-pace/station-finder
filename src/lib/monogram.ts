// Short letters for a station's monogram tile, the same rule for every station:
// a call-sign-style first word as-is ("KVIE", "WETA"), otherwise the initials of its
// capitalized words ("Alabama Public Television" → "APT", "Cascade PBS" → "CP").
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const first = (words[0] ?? '').split('-')[0];
  // "KVIE", "WETA", "KVCR-DT" → the call sign; but a leading network name doesn't count
  // ("PBS SoCal" → "PS", "PBS Charlotte" → "PC").
  if (/^[A-Z0-9]{2,4}$/.test(first) && !(/^(PBS|NPR)$/.test(first) && words.length > 1)) return first;
  const initials = words.filter((w) => /^[\p{Lu}\p{N}]/u.test(w)).map((w) => w[0].toUpperCase()).join('');
  return (initials || first.slice(0, 2)).slice(0, 3);
}

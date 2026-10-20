// Share image for the site's own pages (home, search, states, help, about).
import type { APIRoute } from 'astro';
import { shareImage } from '../../lib/og';

export const GET: APIRoute = async () => {
  const png = await shareImage({
    kicker: 'Public TV and radio, near you',
    title: 'Every way to watch and listen to your local station',
    line: 'Find your station and get its apps',
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};

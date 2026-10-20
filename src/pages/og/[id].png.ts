// Share image per station: /og/<station>.png (see src/lib/og.ts).
import type { APIRoute } from 'astro';
import { organizations, metaLine, type Organization } from '../../lib/data';
import { shareImage } from '../../lib/og';

export function getStaticPaths() {
  return organizations.map((org) => ({ params: { id: org.id }, props: { org } }));
}

export const GET: APIRoute = async ({ props }) => {
  const org = (props as { org: Organization }).org;
  const png = await shareImage({
    kicker: metaLine(org).replace(/^[^·]+· /, ''), // "TV & Radio · Seattle, WA"
    title: org.name,
    line: 'Get the app on your phone, TV, and computer',
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};

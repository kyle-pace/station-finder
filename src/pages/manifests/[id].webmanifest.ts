// A small web app manifest per station, linked from its station page. It names the
// station's own Android (and iPhone) app so Chrome on Android can offer "Get the app"
// for that station (prefer_related_applications). Only for stations with an Android app.
import type { APIRoute } from 'astro';
import { organizations, type Organization } from '../../lib/data';
import { url } from '../../lib/site';

const own = (org: Organization, p: string) => org.apps.find((a) => a.platform === p && !a.extra && a.kind !== 'instructions')?.url;
export const playId = (org: Organization) => own(org, 'android')?.match(/[?&]id=([\w.]+)/)?.[1];
export const appleId = (org: Organization) => own(org, 'ios')?.match(/\/id(\d+)/)?.[1];

export function getStaticPaths() {
  return organizations.filter((o) => playId(o)).map((org) => ({ params: { id: org.id }, props: { org } }));
}

export const GET: APIRoute = ({ props }) => {
  const org = (props as { org: Organization }).org;
  const play = playId(org)!;
  const ios = appleId(org);
  const manifest = {
    name: org.name,
    short_name: org.name.length > 12 ? org.name.slice(0, 12) : org.name,
    start_url: url(`/station/${org.id}/`),
    scope: url(`/station/${org.id}/`),
    display: 'browser',
    background_color: '#0e1118',
    theme_color: '#0e1118',
    icons: [
      { src: url('/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: url('/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
    prefer_related_applications: true,
    related_applications: [
      { platform: 'play', id: play, url: `https://play.google.com/store/apps/details?id=${play}` },
      ...(ios ? [{ platform: 'itunes', id: ios, url: `https://apps.apple.com/app/id${ios}` }] : []),
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), { headers: { 'Content-Type': 'application/manifest+json' } });
};

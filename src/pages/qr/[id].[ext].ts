// Downloadable QR code per station (print and design use): /qr/<station>.png and .svg.
// Encodes the station's /go/ share link. Black on white, with a quiet border so it scans
// when printed. Drawn at build time.
import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { organizations, type Organization } from '../../lib/data';
import { url } from '../../lib/site';

export function getStaticPaths() {
  return organizations.flatMap((org) => (['png', 'svg'] as const).map((ext) => ({ params: { id: org.id, ext }, props: { org } })));
}

export const GET: APIRoute = async ({ props, params, site }) => {
  const org = (props as { org: Organization }).org;
  const link = new URL(url(`/go/${org.id}/`), site).href;
  const opts = { margin: 4, errorCorrectionLevel: 'M' as const, color: { dark: '#000000', light: '#ffffff' } };
  if (params.ext === 'svg') {
    return new Response(await QRCode.toString(link, { ...opts, type: 'svg' }), { headers: { 'Content-Type': 'image/svg+xml' } });
  }
  const png = await QRCode.toBuffer(link, { ...opts, type: 'png', width: 1200 });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};

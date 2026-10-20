// Share images (the preview card when a link is posted to social, Slack, iMessage…).
// Drawn at build time with satori (layout → SVG) and resvg (SVG → PNG); nothing runs in the
// browser. Same template for every station; no station or network logos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const fontDir = join(process.cwd(), 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files');
const fonts = [
  { name: 'Jakarta', data: readFileSync(join(fontDir, 'plus-jakarta-sans-latin-400-normal.woff')), weight: 400 as const, style: 'normal' as const },
  { name: 'Jakarta', data: readFileSync(join(fontDir, 'plus-jakarta-sans-latin-700-normal.woff')), weight: 700 as const, style: 'normal' as const },
  { name: 'Jakarta', data: readFileSync(join(fontDir, 'plus-jakarta-sans-latin-800-normal.woff')), weight: 800 as const, style: 'normal' as const },
];

// The site's play-pin mark, as an image.
const logo = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20 37s-13-11-13-21a13 13 0 0 1 26 0c0 10-13 21-13 21z" fill="#ffffff"/><path d="M16.5 10.5v11l9-5.5z" fill="#0f5e63"/></svg>',
).toString('base64')}`;

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown; src?: string; width?: number; height?: number } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });

export async function shareImage({ kicker, title, line }: { kicker: string; title: string; line: string }): Promise<Buffer> {
  const size = title.length > 40 ? 64 : title.length > 22 ? 80 : 104;
  const tree = el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px',
    backgroundColor: '#0f5e63', backgroundImage: 'radial-gradient(circle at 92% 0%, #3a6e64 0%, #0f5e63 45%)',
    color: '#ffffff', fontFamily: 'Jakarta',
  }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 700 }, [
      el('img', {}, undefined, { src: logo, width: 48, height: 48 }),
      el('div', {}, 'Find My Station'),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', gap: 18, width: 1056 }, [
      el('div', { display: 'flex', fontSize: 30, color: '#ffd2c2', fontWeight: 700 }, kicker),
      el('div', { display: 'flex', width: 1056, fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, title),
      el('div', { display: 'flex', fontSize: 36, color: '#d6e8e6' }, line),
    ]),
    el('div', { display: 'flex', height: 40 }), // balances the brand row so the text sits mid-card
  ]);
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
}

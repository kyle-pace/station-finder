// Share images (the preview card when a link is posted to social, Slack, iMessage…).
// Drawn at build time with satori (layout → SVG) and resvg (SVG → PNG); nothing runs in the
// browser. Same template for every station; no station or network logos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const fontDir = join(process.cwd(), 'node_modules', '@fontsource', 'figtree', 'files');
const fonts = [
  { name: 'Figtree', data: readFileSync(join(fontDir, 'figtree-latin-400-normal.woff')), weight: 400 as const, style: 'normal' as const },
  { name: 'Figtree', data: readFileSync(join(fontDir, 'figtree-latin-700-normal.woff')), weight: 700 as const, style: 'normal' as const },
  { name: 'Figtree', data: readFileSync(join(fontDir, 'figtree-latin-800-normal.woff')), weight: 800 as const, style: 'normal' as const },
];

// The site's broadcast-wave mark, as an image.
const logo = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="9" cy="23" r="4.5" fill="#ff8a5c"/><path d="M9 12.5A10.5 10.5 0 0 1 19.5 23" fill="none" stroke="#8fb0ff" stroke-width="3.4" stroke-linecap="round"/><path d="M9 4.5A18.5 18.5 0 0 1 27.5 23" fill="none" stroke="#8fb0ff" stroke-opacity=".55" stroke-width="3.4" stroke-linecap="round"/></svg>',
).toString('base64')}`;

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown; src?: string; width?: number; height?: number } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });

export async function shareImage({ kicker, title, line }: { kicker: string; title: string; line: string }): Promise<Buffer> {
  const size = title.length > 40 ? 64 : title.length > 22 ? 80 : 104;
  const tree = el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px',
    backgroundColor: '#0e1118', backgroundImage: 'linear-gradient(135deg, #16203a 0%, #0e1118 55%, #2a1a14 100%)',
    color: '#eef1f7', fontFamily: 'Figtree',
  }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 700 }, [
      el('img', {}, undefined, { src: logo, width: 48, height: 48 }),
      el('div', {}, 'Station App Finder'),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', gap: 18, width: 1056 }, [
      el('div', { display: 'flex', fontSize: 30, color: '#ff8a5c', fontWeight: 700 }, kicker),
      el('div', { display: 'flex', width: 1056, fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, title),
      el('div', { display: 'flex', fontSize: 36, color: '#b8c0d0' }, line),
    ]),
    el('div', { display: 'flex', height: 40 }), // balances the brand row so the text sits mid-card
  ]);
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
}

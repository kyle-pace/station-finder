// @ts-check
import { defineConfig } from 'astro/config';

// Prototype is hosted on GitHub Pages at https://kyle-pace.github.io/station-finder/
// When the repo moves or a custom domain is added, update `site` and `base` here.
export default defineConfig({
  site: 'https://kyle-pace.github.io',
  base: '/station-finder',
  output: 'static',
  trailingSlash: 'ignore',
});

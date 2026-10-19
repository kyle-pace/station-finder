// @ts-check
import { defineConfig } from 'astro/config';

// Prototype is hosted on GitHub Pages at https://kyle-pace.github.io/station-finder/
// When the repo moves or a custom domain is added, update `site` and `base` here.
export default defineConfig({
  site: 'https://kyle-pace.github.io',
  base: '/station-finder',
  output: 'static',
  trailingSlash: 'ignore',
  vite: {
    // A new value on every build, added to data file URLs (search.json, zip/*.json) so a
    // browser never mixes new page code with data it cached from an older build.
    define: { __DATA_VERSION__: JSON.stringify(Date.now().toString(36)) },
  },
});

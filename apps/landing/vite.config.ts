import { createHash } from 'node:crypto';
import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  // Vite refuses a Host it does not recognise. The preview is how we check
  // the stats host rewrite; production Workers do not consult this list.
  preview: {
    allowedHosts: ['stats.changuito.me', 'www.changuito.me', 'changuito.me'],
  },
  server: {
    allowedHosts: ['stats.changuito.me', 'www.changuito.me', 'changuito.me'],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
  css: {
    modules: {
      generateScopedName(name: string, filename: string) {
        const relativePath = path.relative(import.meta.dirname, filename.replace(/\?.*$/, '')).replaceAll('\\', '/');
        return `_${name}_${createHash('sha256').update(relativePath).digest('hex').slice(0, 7)}`;
      },
    },
  },
});

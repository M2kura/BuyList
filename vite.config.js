import { defineConfig } from 'vite';

const BASE = '/buylist/';

export default defineConfig({
  base: BASE,
  server: {
    port: 5174,
    // `npm run dev` runs the API on :3005 next to Vite; the API serves under the same base path.
    proxy: { [`${BASE}api`]: 'http://127.0.0.1:3005' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});

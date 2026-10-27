import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable, and the app shell loads offline. API responses are not cached here: the app
    // keeps the last loaded conditions itself (lib/storage.ts) so it can show their age.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Launch Window',
        short_name: 'Launch Window',
        description:
          'River flow, water temperature, wind, weather and daylight for the next 48 hours, compared with your limits.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fcfbf8',
        theme_color: '#2563a8',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Same-origin API calls (the development proxy) must reach the network, not index.html.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // The API has no CORS, so in development the web app reaches it through this proxy.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});

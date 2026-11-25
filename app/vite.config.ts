import { defineConfig, loadEnv, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { handleAI } from './server/ai.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ['ANTHROPIC_', 'AI_ACCESS_CODE']), ...process.env };
  const ai: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/ai') return next();
    void handleAI(request, response, env);
  };
  return {
    plugins: [
      react(),
      { name: 'local-ai', configureServer(server) { server.middlewares.use(ai); }, configurePreviewServer(server) { server.middlewares.use(ai); } },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon-180.png'],
        manifest: {
          id: '/', name: 'Niall Search OS', short_name: 'Search OS',
          description: 'Private workspace for an executive job search',
          start_url: '/', scope: '/', display: 'standalone',
          background_color: '#f7f8f5', theme_color: '#173327',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: { navigateFallbackDenylist: [/^\/api\//], cleanupOutdatedCaches: true },
      }),
    ],
  };
});

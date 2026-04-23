import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // 自动更新 Service Worker
      includeAssets: [],
      manifest: {
        name: '作业看板',
        short_name: '作业看板',
        description: '一个 Material You 风格的作业管理工具',
        theme_color: '#6750A4',
        background_color: '#F5EFFB',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        "icons": [
          {
            "src": "/assets/favicon_192x.png",
            "sizes": "192x192",
            "type": "image/png"
          },
          {
            "src": "/assets/favicon_512x.png",
            "sizes": "512x512",
            "type": "image/png"
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,txt,woff2}'], // 预缓存文件
        globIgnores: ['**/favicon_*.png'], // 排除图标PNG（由manifest icons单独管理）
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true, // 开发环境下启用 Service Worker（需要 HTTPS 或 localhost）
        type: 'module'  // 让 SW 以模块形式运行（便于调试）
      }
    })
  ]
});
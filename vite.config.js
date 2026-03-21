import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // 自动更新 Service Worker
      includeAssets: ['favicon.ico', 'favicon.png'], 
      manifest: {
        name: '作业看板',
        short_name: '作业看板',
        description: '一个 Material You 风格的作业管理工具',
        theme_color: '#6750A4',
        background_color: '#F5EFFB',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/favicon.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'], // 预缓存文件
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
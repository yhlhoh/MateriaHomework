import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // 自动更新 Service Worker
      // 由 main.js 中的 virtual:pwa-register 统一注册，避免与手动注册重复
      injectRegister: 'auto',
      includeAssets: ['assets/favicon_192x.png', 'assets/favicon_512x.png'],
      manifest: {
        id: '/',
        name: '作业看板',
        short_name: '作业看板',
        description: '一个 Material You 风格的作业管理工具',
        lang: 'zh-CN',
        dir: 'ltr',
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
        // 预缓存应用外壳：离线时 index.html / JS / CSS / 图标 / 字体都能命中缓存
        globPatterns: ['**/*.{js,css,html,ico,png,svg,txt,woff,woff2,ttf}'],
        globIgnores: ['**/favicon_*.png'], // 图标由 includeAssets / manifest icons 单独管理
        // 离线打开看板时回退到应用外壳（SPA 路由）
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Google Sans webfont：CSS 与字体文件都在该域下
            urlPattern: /^https:\/\/fonts\.cdnfonts\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdnfonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              // 跨域字体响应可能是不透明的（status 0），需要显式允许缓存
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
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

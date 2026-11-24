import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: [
        "apple-touch-icon.png",
        "favicon.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
      ],
      manifest: {
        name: "Soundboard",
        short_name: "Soundboard",
        description: "Offline soundboard and audio clipper",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#09090b",
        background_color: "#09090b",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        globIgnores: ["**/sounds/**"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname === "rentry.co" ||
              url.hostname === "rentry.org" ||
              url.pathname.includes("/sounds/live/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.includes("/sounds/") ||
              url.hostname === "raw.githubusercontent.com",
            handler: "NetworkFirst",
            options: {
              cacheName: "soundboard-clips",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.includes("huggingface.co") ||
              url.hostname.includes("hf.co") ||
              url.hostname.includes("hf-mirror.com"),
            handler: "CacheFirst",
            options: {
              cacheName: "whisper-models",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});

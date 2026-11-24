import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function boardPublishPlugin() {
  let deployTimer = 0;
  return {
    name: "board-publish",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/__board-publish") return next();
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = JSON.parse((await collectBody(req)).toString("utf8"));
          const dir = path.resolve("public/sounds");
          await fs.mkdir(dir, { recursive: true });
          const keep = new Set(["manifest.json"]);
          const clips = [];
          for (const clip of body.clips || []) {
            if (!clip?.id) continue;
            const name = `${clip.id}.wav`;
            keep.add(name);
            clips.push({
              id: clip.id,
              title: clip.title,
              friendId: clip.friendId,
              duration: clip.duration || 0,
              createdAt: clip.createdAt,
              file: name,
              volume: clip.volume ?? 1,
              playbackRate: clip.playbackRate ?? 1,
              preservePitch: clip.preservePitch !== false,
            });
            if (clip.audio) {
              await fs.writeFile(path.join(dir, name), Buffer.from(clip.audio, "base64"));
            }
          }
          await fs.writeFile(
            path.join(dir, "manifest.json"),
            `${JSON.stringify({ version: 2, friends: body.friends || [], clips }, null, 2)}\n`
          );
          for (const name of await fs.readdir(dir)) {
            if (name.endsWith(".wav") && !keep.has(name)) await fs.unlink(path.join(dir, name));
          }
          res.statusCode = 204;
          res.end();
          clearTimeout(deployTimer);
          deployTimer = setTimeout(() => {
            spawn("npm", ["run", "deploy"], {
              cwd: process.cwd(),
              stdio: "ignore",
              detached: true,
              shell: true,
            }).unref();
          }, 4000);
        } catch (error) {
          res.statusCode = 500;
          res.end(error.message || "publish failed");
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    boardPublishPlugin(),
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
            urlPattern: ({ url }) => url.pathname.includes("/sounds/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "soundboard-clips",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 30 },
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

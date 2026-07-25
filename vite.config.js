import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/shipping-picking-system/",

  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],

      manifest: {
        name: "出荷ピッキングシステム",
        short_name: "出荷ピッキング",
        description:
          "Androidタブレット用出荷ピッキングシステム",
        lang: "ja",

        start_url: "/shipping-picking-system/",
        scope: "/shipping-picking-system/",

        display: "standalone",
        orientation: "landscape",

        background_color: "#eef2f6",
        theme_color: "#173f67",

        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        navigateFallback:
          "/shipping-picking-system/index.html",

        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webmanifest}",
        ],
      },
    }),
  ],
});
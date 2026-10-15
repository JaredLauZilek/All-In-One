import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable web app (iPhone "Add to Home Screen", 2026-10-15). The service
    // worker only precaches the built shell (html/js/css/fonts/icons) and
    // auto-updates on the next open; Supabase/API calls are NEVER cached —
    // the data always needs the network.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icons/*.png"],
      manifest: {
        name: "All-In-One",
        short_name: "All-In-One",
        description: "Jared's tools: Financial Desk, Earnings Vol, Training",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f4f5f1",
        theme_color: "#f4f5f1",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // never let the SW answer API/auth traffic
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//],
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      },
    }),
  ],
  // allow access through GitHub Codespaces port forwarding (*.app.github.dev)
  server: {
    host: true,
    allowedHosts: true,
    // Hot reload through the forwarded-port URL: the page arrives over
    // HTTPS:443, so the HMR websocket must dial 443 too (GitHub forwards it
    // back to 5173). Without this the browser tries wss://…github.dev:5173,
    // the socket dies silently, and open tabs never live-update.
    // Scoped to Codespaces so plain localhost dev elsewhere stays default.
    hmr: process.env.CODESPACES ? { clientPort: 443 } : undefined,
  },
});

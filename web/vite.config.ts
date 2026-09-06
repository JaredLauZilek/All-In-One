import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

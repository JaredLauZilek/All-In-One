import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // allow access through GitHub Codespaces port forwarding (*.app.github.dev)
  server: {
    host: true,
    allowedHosts: true,
  },
});

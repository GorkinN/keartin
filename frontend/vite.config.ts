import path from "node:path";
import type { ProxyOptions } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const nestProxy: ProxyOptions = {
  target: "http://127.0.0.1:3000",
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/library": nestProxy,
      "/posts": nestProxy,
      "/presets": nestProxy,
      "/image-presets": nestProxy,
      "/generate": nestProxy,
      "/gpu": nestProxy,
      "/health": nestProxy,
    },
  },
});

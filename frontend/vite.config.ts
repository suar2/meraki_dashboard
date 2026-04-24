import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const frontendPort = Number(process.env.FRONTEND_PORT || env.FRONTEND_PORT || 3300);
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: frontendPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      watch: {
        // NAS/CIFS filesystems don't support inotify — use polling
        usePolling: true,
        interval: 1000,
      },
    },
  };
});

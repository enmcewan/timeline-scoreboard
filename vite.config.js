import { defineConfig } from "vite";

const liveDataProxy = {
  target: "https://lauris-webdev.com",
  changeOrigin: true,
  rewrite: (requestPath) => requestPath.replace(/^\/live-data/, "/timeline-data"),
};

export default defineConfig({
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/live-data": liveDataProxy,
    },
  },
  preview: {
    proxy: {
      "/live-data": liveDataProxy,
    },
  },
});

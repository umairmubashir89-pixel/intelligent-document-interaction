import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// ESM-safe Vite config for Node 22
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 8789,     // dev preview (when you run `npm run preview`)
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
});

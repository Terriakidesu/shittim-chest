import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 4174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

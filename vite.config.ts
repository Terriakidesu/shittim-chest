import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works at a repository subpath
// (https://<user>.github.io/<repo>/) and at a custom root domain.
// All runtime data/image URLs are relative for the same reason.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works at a repository subpath
// (https://<user>.github.io/<repo>/) and at a custom root domain.
// All runtime data/image URLs are relative for the same reason.
//
// One entry per route. A URL fragment never reaches the server, so the routes
// have to be distinct documents or every shared link yields the same metadata.
// Each entry sits flat at the root (not in a subdirectory) precisely so that
// relative asset URLs keep resolving from any of them. They all load the same
// main.tsx, and Rollup emits a single shared chunk, so the extra entries cost
// three small HTML files and no duplicated JavaScript.
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: page("index.html"),
        calendar: page("calendar.html"),
        simulator: page("simulator.html"),
        about: page("about.html"),
      },
    },
  },
});

/* ==========================================================================
 *  Buka Delivery — vitest.config.mts
 *
 *  Ρύθμιση όπως στον οδηγό Vitest της τεκμηρίωσης του Next.js 16
 *  (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md).
 *
 *  Προεπιλογή: περιβάλλον Node. Τα tests του UI δηλώνουν στην πρώτη γραμμή
 *  `// @vitest-environment jsdom`.
 * ========================================================================== */

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // Το Next.js χειρίζεται το "server-only" εσωτερικά· στα tests δεν υπάρχει πακέτο
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});

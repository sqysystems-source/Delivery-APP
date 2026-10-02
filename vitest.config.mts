/* ==========================================================================
 *  Buka Delivery — vitest.config.mts
 *
 *  Written for the versions in package-lock.json (vitest 3.2.x, vite 6,
 *  @vitejs/plugin-react 4, vite-tsconfig-paths 5).
 *
 *  • Default environment: node. UI tests opt into jsdom with the
 *    `// @vitest-environment jsdom` docblock at the top of the file.
 *  • `server-only` is a Next.js marker package (Next bundles its own copy);
 *    outside Next it doesn't resolve, so tests use an empty stub.
 *  • Firestore Emulator rules tests live in tests/emulator/*.emulator.ts and
 *    are NOT matched here — they run only via `npm run test:rules`
 *    (vitest.emulator.config.mts) inside `firebase emulators:exec`.
 * ========================================================================== */

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "tests/emulator/**"],
  },
});

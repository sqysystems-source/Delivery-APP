/* ==========================================================================
 *  Buka Delivery — vitest.emulator.config.mts
 *
 *  ΜΟΝΟ για τα tests κανόνων με τον Firestore Emulator:
 *
 *    npm run test:rules
 *      = firebase emulators:exec --config firebase.rules-test.json
 *          --only firestore --project demo-buka "vitest run --config …"
 *
 *  Το project "demo-buka" (πρόθεμα demo-) δεν αντιστοιχεί σε πραγματικό
 *  project: τα SDK δεν μιλούν ποτέ με την παραγωγή. Τα ίδια τα tests
 *  αρνούνται να τρέξουν χωρίς FIRESTORE_EMULATOR_HOST.
 * ========================================================================== */

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/emulator/**/*.emulator.ts"],
    // Ένας κοινός emulator: τα αρχεία τρέχουν σειριακά
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/svg/index.ts",
    "src/d3/index.ts",
  ],
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  clean: true,
  // Bundle the small D3 modules so CJS and the unbundled browser demo work too.
  // The core entry imports none of these modules.
  noExternal: [/^d3-/],
});

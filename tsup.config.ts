import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "core/index": "src/core/index.ts",
    "svg/index": "src/svg/index.ts",
    "d3/index": "src/d3/index.ts",
    photon: "src/svg/photon.css",
  },
  format: ["esm", "cjs"],
  splitting: true,
  dts: {
    entry: [
      "src/index.ts",
      "src/core/index.ts",
      "src/svg/index.ts",
      "src/d3/index.ts",
    ],
  },
  clean: true,
  // Bundle the small D3 modules so CJS and the unbundled browser demo work too.
  // The core entry imports none of these modules.
  noExternal: [/^d3-/],
});

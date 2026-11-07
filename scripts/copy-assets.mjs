import { copyFile, readFile } from "node:fs/promises";
const template = await readFile(
  new URL("../docs/photon-template.html", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/svg/photon.css", import.meta.url),
  "utf8",
);
// for (const selector of [":root", 'html[data-theme="dark"]']) {
//   const block = template.match(
//     new RegExp(
//       `  ${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[\\s\\S]*?\\n  \\}`,
//     ),
//   )?.[0];
//   if (!block || !css.includes(block))
//     throw new Error(
//       `Photon token block changed: ${selector}. Copy the template verbatim.`,
//     );
// }
await copyFile(
  new URL("../src/svg/photon.css", import.meta.url),
  new URL("../dist/photon.css", import.meta.url),
);

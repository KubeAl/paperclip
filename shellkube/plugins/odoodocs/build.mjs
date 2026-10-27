// Bundles manifest + worker (node), the Files tab (host page) and the new-tab editor page. Uses the fork's esbuild + SDK.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(path.join(root, "package.json"));
const esbuild = require("esbuild");
const sdk = path.join(root, "packages/plugins/sdk");
const alias = { "@paperclipai/plugin-sdk": path.join(sdk, "dist/index.js") };
for (const name of ["manifest", "worker"]) {
  await esbuild.build({ entryPoints: [path.join(here, `src/${name}.ts`)], outfile: path.join(here, `dist/${name}.js`),
    bundle: true, format: "esm", platform: "node", target: "node22", alias, loader: { ".md": "text" },
    nodePaths: [path.join(root, "node_modules"), path.join(sdk, "node_modules")],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: "warning" });
}
await esbuild.build({ entryPoints: [path.join(here, "src/ui/index.tsx")], outfile: path.join(here, "dist/ui/index.js"),
  bundle: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  // Keep whitespace: the host rewrites imports by matching ` from "react"` (with the space).
  minifyIdentifiers: true, minifySyntax: true,
  external: ["react", "react-dom", "react/jsx-runtime", "@paperclipai/plugin-sdk/ui"], logLevel: "warning" });
await esbuild.build({ entryPoints: [path.join(here, "src/editor/page.ts")], outfile: path.join(here, "dist/ui/editor/page.js"),
  bundle: true, minify: true, format: "iife", platform: "browser", target: "es2022", logLevel: "warning" });
fs.copyFileSync(path.join(here, "src/editor/index.html"), path.join(here, "dist/ui/editor/index.html"));
console.log("odoodocs built");

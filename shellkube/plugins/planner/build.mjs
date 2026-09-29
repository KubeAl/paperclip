// Bundles manifest + worker (node) and UI (browser). Uses the fork's own esbuild + plugin SDK; no install needed.
import { createRequire } from "node:module";
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
    bundle: true, format: "esm", platform: "node", target: "node22", alias, nodePaths: [path.join(root, "node_modules"), path.join(sdk, "node_modules")],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: "warning" });
}
await esbuild.build({ entryPoints: [path.join(here, "src/ui/index.tsx")], outfile: path.join(here, "dist/ui/index.js"),
  bundle: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "@paperclipai/plugin-sdk/ui"], logLevel: "warning" });
console.log("planner built");

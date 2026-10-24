// Bundles manifest + worker (node) and UI (browser). Uses the fork's own esbuild + plugin SDK; no install needed.
import { createRequire } from "node:module";
import crypto from "node:crypto";
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
    bundle: true, format: "esm", platform: "node", target: "node22", alias, nodePaths: [path.join(root, "node_modules"), path.join(sdk, "node_modules")],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: "warning" });
}
await esbuild.build({ entryPoints: [path.join(here, "src/ui/index.tsx")], outfile: path.join(here, "dist/ui/index.js"),
  bundle: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  // Keep whitespace: the host rewrites imports by matching ` from "react"` (with the space).
  minifyIdentifiers: true, minifySyntax: true,
  external: ["react", "react-dom", "react/jsx-runtime", "@paperclipai/plugin-sdk/ui"], logLevel: "warning" });
// o-spreadsheet runs in its own frame page (Owl + Bootstrap CSS must not touch the host page). Its prebuilt files are
// joined into one content-hashed .js and .css, which the host serves as immutable (no revalidation on later loads).
const owlOut = path.join(here, "dist/ui/owl"), read = (f) => fs.readFileSync(path.join(here, f), "utf8");
fs.rmSync(owlOut, { recursive: true, force: true });
fs.mkdirSync(owlOut, { recursive: true });
// The frame has an opaque origin, so the host's font files fail CORS; inline the woff2 instead.
const woff2 = fs.readFileSync(path.join(here, "node_modules/font-awesome/fonts/fontawesome-webfont.woff2")).toString("base64");
const css = [
  read("node_modules/bootstrap/dist/css/bootstrap.min.css"),
  read("node_modules/font-awesome/css/font-awesome.min.css")
    .replace(/src:url\('..\/fonts\/fontawesome-webfont.eot\?v=4.7.0'\);src:[^;]+;/, `src:url(data:font/woff2;base64,${woff2}) format('woff2');`),
  read("node_modules/@odoo/o-spreadsheet/dist/o_spreadsheet.css"),
].join("\n");
const js = [
  read("node_modules/@odoo/owl/dist/owl.iife.min.js"),
  read("node_modules/chart.js/dist/chart.umd.js"),
  `window.OSP_TEMPLATES = ${JSON.stringify(read("node_modules/@odoo/o-spreadsheet/dist/o_spreadsheet.xml"))};`,
  read("node_modules/@odoo/o-spreadsheet/dist/o_spreadsheet.iife.min.js"),
  read("src/owl/frame.js"),
].join("\n;\n");
const hashed = (ext, text) => {
  const name = `app.${crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)}.${ext}`;
  fs.writeFileSync(path.join(owlOut, name), text);
  return name;
};
fs.writeFileSync(path.join(owlOut, "index.html"), read("src/owl/index.html").replace("app.css", hashed("css", css)).replace("app.js", hashed("js", js)));
console.log("livepanel built");

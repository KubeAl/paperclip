import path from "node:path";
import { defineConfig } from "vitest/config";

const sdk = path.resolve(import.meta.dirname, "../../../packages/plugins/sdk/dist");
export default defineConfig({
  resolve: { alias: [
    { find: "@paperclipai/plugin-sdk/testing", replacement: path.join(sdk, "testing.js") },
    { find: "@paperclipai/plugin-sdk", replacement: path.join(sdk, "index.js") },
  ] },
  // esbuild imports SKILL.md as text (build.mjs); do the same here.
  plugins: [{ name: "md-text", transform: (code, id) => (id.endsWith(".md") ? `export default ${JSON.stringify(code)};` : undefined) }],
  test: { include: ["tests/**/*.spec.ts"], environment: "node" },
});

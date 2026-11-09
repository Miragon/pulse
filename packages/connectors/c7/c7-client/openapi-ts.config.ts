import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  // The one Camunda 7 REST spec of the c7 family with its patches applied, as c7-core's
  // `generate` writes it (its route table and the CLI's catalog read the same spec); a file
  // read, no import, so turbo runs c7-core's `generate` first (turbo.json).
  input: "../c7-core/spec/patched/api.json",
  output: { path: "./src/generated", module: { extension: ".js" } },
  plugins: [
    "@hey-api/typescript",
    // `responseStyle: "data"` + `throwOnError: true` are declared here (not in
    // the hand-written factory) so the generated SDK signatures and the runtime
    // behavior come from the same source: SDK functions return the payload
    // directly and reject on HTTP errors.
    { name: "@hey-api/sdk", responseStyle: "data" },
    {
      name: "@hey-api/client-fetch",
      throwOnError: true,
      // Runtime defaults (headers, throwOnError, responseStyle) shared by the
      // generated default client and `createEngineClient` (see src/hey-api.ts).
      // openapi-ts resolves this path relative to the package root (cwd) and
      // then emits the computed relative import into
      // src/generated/client.gen.ts (keeping the build's `.js` extension).
      runtimeConfigPath: "./src/hey-api.js",
    },
  ],
})

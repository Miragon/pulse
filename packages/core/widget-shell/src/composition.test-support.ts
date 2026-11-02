import { composeModules, type ComposableModule } from "./composition.js"
import { createToolsetVocabulary } from "./toolsets.js"

/** The test modules and the composition the composition tests share. */

export interface TestShared {
  tag: string
}

export const moduleOf = (
  name: string,
  overrides: Partial<ComposableModule<TestShared>> = {},
): ComposableModule<TestShared> => ({
  name,
  configFromEnv: (env) => ({ url: env[`${name.toUpperCase()}_URL`] ?? "default" }),
  knownEnvVars: [`${name.toUpperCase()}_URL`],
  toolsets: createToolsetVocabulary(
    name,
    ["read-only", "operations", "admin"] as const,
    "read-only",
    {
      authenticatedDefault: "operations",
    },
  ),
  createPlugin: (config, shared) =>
    ({ name, register: () => {}, config, shared }) as ReturnType<
      ComposableModule<TestShared>["createPlugin"]
    >,
  ...overrides,
})

export const compose = (
  modules: ComposableModule<TestShared>[] = [moduleOf("alpha"), moduleOf("beta")],
) =>
  composeModules<TestShared>({
    label: "test-root",
    modules,
    appEnvVars: ["MCP_ACTIVE_MODULES", "MCP_URL"],
  })

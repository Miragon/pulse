import type { RestRoute } from "./fake-engine-rest.js"
import { fixture } from "./fixtures.js"

interface Definition {
  readonly id: string
  readonly key: string
}

const DEFINITIONS = (
  JSON.parse(fixture("definition-statistics.json")) as { readonly definition: Definition }[]
).map((row) => row.definition)

export function definitionsNamed(
  by: "processDefinitionIdIn" | "keysIn",
  values: readonly string[],
): RestRoute {
  const named = (definition: Definition) =>
    values.includes(by === "keysIn" ? definition.key : definition.id)
  return {
    route: "GET /process-definition",
    when: (url) =>
      url.searchParams.get(by) === values.join(",") && url.searchParams.get("sortBy") === "id",
    answer: DEFINITIONS.filter(named).sort((left, right) => (left.id < right.id ? -1 : 1)),
  }
}

import { describe, expect, test } from "vitest"
import { ElementScopes } from "../../src/reading/element-scopes.js"
import type { CamundaClient, ElementInstanceView } from "../../src/rest/index.js"
import { clientWith, problem } from "../support/fake-camunda-rest.js"
import { element } from "../support/rows.js"

const MOST_REMEMBERED = 10_000

function counted() {
  const asked: string[] = []
  const client = {
    elementInstance: (key: string): Promise<ElementInstanceView> => {
      asked.push(key)
      return Promise.resolve({
        key,
        elementId: "Poll",
        type: "SERVICE_TASK",
        state: "COMPLETED",
        startedAt: "2026-11-05T10:00:00.000Z",
      })
    },
  } as unknown as CamundaClient
  return { asked, scopes: new ElementScopes(client) }
}

describe("the element scopes", () => {
  test("look an element up once and remember it, but never one that is missing", async () => {
    const { camunda, client } = clientWith([
      { route: "GET /element-instances/7", answer: element("7", "Review", "USER_TASK") },
      { route: "GET /element-instances/8", answer: problem(404, "NOT_FOUND", "missing") },
    ])
    const scopes = new ElementScopes(client)

    expect((await scopes.of("7"))?.elementId).toBe("Review")
    expect((await scopes.of("7"))?.elementId).toBe("Review")
    expect(await scopes.of("8")).toBeUndefined()
    expect(await scopes.of("8")).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /element-instances/7",
      "GET /element-instances/8",
      "GET /element-instances/8",
    ])
  })

  test("forget what they hold once they hold 10,000 elements", async () => {
    const { asked, scopes } = counted()

    for (let index = 0; index <= MOST_REMEMBERED; index += 1) {
      await scopes.of(String(index))
    }
    await scopes.of(String(MOST_REMEMBERED))
    await scopes.of("0")

    expect(asked).toHaveLength(MOST_REMEMBERED + 2)
    expect(asked.at(-1)).toBe("0")
  })
})

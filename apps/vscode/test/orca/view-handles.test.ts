import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { ViewHandles } from "../../dev/orca/worker/view-handles.js"

describe("view handles", () => {
  test("name each view so its tab says what it shows", () => {
    expect(ViewHandles.fileName({ engine: "shop-dev", view: "engine" })).toBe(
      "shop-dev processes.pulse-view",
    )
    expect(
      ViewHandles.fileName({ engine: "shop-dev", view: "definition", bpmnProcessId: "order" }),
    ).toBe("order.pulse-view")
    expect(
      ViewHandles.fileName({
        engine: "shop-dev",
        view: "instance",
        instanceId: "e199b7ba-dab1-11f1-8a75",
      }),
    ).toBe("e199b7ba.pulse-view")
    expect(
      ViewHandles.fileName({ engine: "shop-dev", view: "migration", bpmnProcessId: "order" }),
    ).toBe("migrate order.pulse-view")
  })

  test("keep a filtered definition apart from the plain one", () => {
    const plain = ViewHandles.keyOf({ engine: "e", view: "definition", bpmnProcessId: "order" })
    const filtered = ViewHandles.keyOf({
      engine: "e",
      view: "definition",
      bpmnProcessId: "order",
      filter: { scope: "running", elementId: "Task" },
    })

    expect(filtered).not.toBe(plain)
    expect(filtered).toMatch(/^e\/order [0-9a-f]{6}\.pulse-view$/)
  })

  test("never let a name leave its folder", () => {
    expect(
      ViewHandles.fileName({ engine: "e", view: "definition", bpmnProcessId: "../../etc/passwd" }),
    ).toBe(".._.._etc_passwd.pulse-view")
  })

  test("write a handle that parses back to its request, next to a .gitignore", async () => {
    const root = await mkdtemp(join(tmpdir(), "pulse-views-"))
    const file = await ViewHandles.write(root, {
      engine: "shop-dev",
      view: "instance",
      instanceId: "abc",
    })

    expect(ViewHandles.parse(await readFile(file, "utf8"))).toEqual({
      pulse: 1,
      engine: "shop-dev",
      view: "instance",
      instanceId: "abc",
    })
    expect(await readFile(join(root, ".pulse", "views", ".gitignore"), "utf8")).toBe("*\n")
  })

  test("refuse text that is no Pulse view", () => {
    expect(ViewHandles.parse("not json")).toBeUndefined()
    expect(ViewHandles.parse('{"pulse":2,"engine":"e","view":"engine"}')).toBeUndefined()
  })
})

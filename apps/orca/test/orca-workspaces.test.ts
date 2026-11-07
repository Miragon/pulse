import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { OrcaWorkspaceFiles } from "../src/worker/orca-workspace-files.js"
import { OrcaWorkspaces } from "../src/worker/orca-workspaces.js"
import { FakeOrca } from "./fake-orca.js"

const SHOP = { id: "shop", name: "shop", path: "/work/shop", branch: null, hostId: null }
const FEATURE = {
  id: "feature",
  name: "shop",
  path: "/work/shop-feature",
  branch: "feature",
  hostId: "local",
}
const NESTED = { id: "nested", name: "api", path: "/work/shop/api", branch: null, hostId: null }
const REMOTE = { id: "remote", name: "shop", path: "/srv/shop", branch: "main", hostId: "ssh-1" }

function workspacesOf(...listed: object[]): { orca: FakeOrca; workspaces: OrcaWorkspaces } {
  const orca = new FakeOrca()
  orca.hostAnswers = { "workspace.list": { workspaces: listed } }
  return { orca, workspaces: new OrcaWorkspaces(orca.api()) }
}

describe("the workspaces of Orca", () => {
  test("follow the focused workspace by its name and branch", async () => {
    const { workspaces } = workspacesOf(SHOP, FEATURE)

    workspaces.noteFocus({ branch: "feature", displayName: "shop" })

    expect((await workspaces.focusedWorkspace())?.id).toBe("feature")
  })

  test("read the focus from Orca until an event names it", async () => {
    const { orca, workspaces } = workspacesOf(SHOP, FEATURE)
    orca.hostAnswers = {
      ...orca.hostAnswers,
      "workspace.readContext": { branch: "", displayName: "shop" },
    }

    expect((await workspaces.focusedWorkspace())?.id).toBe("shop")
  })

  test("fall back to the first local workspace", async () => {
    const { orca, workspaces } = workspacesOf(REMOTE, FEATURE)
    orca.failingHostCalls.add("workspace.readContext")

    expect((await workspaces.focusedWorkspace())?.id).toBe("feature")
  })

  test("know no workspace when Orca lists none", async () => {
    const { orca, workspaces } = workspacesOf()
    orca.failingHostCalls.add("workspace.list")

    expect(await workspaces.focusedWorkspace()).toBeUndefined()
  })

  test("open a file in the innermost local workspace that holds it", async () => {
    const { orca, workspaces } = workspacesOf(SHOP, NESTED, REMOTE)

    await workspaces.openFile("/work/shop/api/src/order.bpmn")

    expect(orca.hostCalls.slice(1)).toEqual([
      { method: "workspace.open", params: { workspaceId: "nested" } },
      { method: "editor.open", params: { workspaceId: "nested", path: "src/order.bpmn" } },
    ])
    expect(await workspaces.holding("/srv/shop/order.bpmn")).toBeUndefined()
    expect(await workspaces.holding("/work/shop-other/order.bpmn")).toBeUndefined()
  })
})

describe("the files of the workspaces", () => {
  test("stop at the limit and read a file by its URI", async () => {
    const root = await mkdtemp(join(tmpdir(), "pulse-files-"))
    await mkdir(join(root, "dist"))
    await writeFile(join(root, "a.bpmn"), "a")
    await writeFile(join(root, "b.bpmn"), "b")
    await writeFile(join(root, "dist", "c.bpmn"), "c")
    const files = new OrcaWorkspaceFiles(() => [root])

    const all = await files.find("**/*.bpmn", 10)
    const first = await files.find("**/*.bpmn", 1)

    expect(all.map((uri) => uri.slice(-6)).sort()).toEqual(["a.bpmn", "b.bpmn"])
    expect(first).toHaveLength(1)
    expect(await files.read(pathToFileURL(join(root, "a.bpmn")).toString())).toBe("a")
  })
})

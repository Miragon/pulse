import { DefinitionId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { BoardBuilder, BoardJson, type TileModel } from "../../src/builder/index.js"
import { BuilderWorld } from "./support/engines.js"

const FAILED = () => Promise.reject(new RuntimeError("engineFailure", "boom"))

function only(rows: readonly (readonly TileModel[])[], row = 0): TileModel {
  const found = rows[row]?.[0]
  if (found === undefined) {
    throw new Error(`expected a tile in row ${row}`)
  }
  return found
}

describe("an incident summary", () => {
  test("counts instances with incident per engine, from every engine's definitions", async () => {
    const board = BuilderWorld.board(
      [{ widget: "incidentSummary", props: { groupBy: "engine" } }],
      ["shop", "flaky", "prod"],
    )
    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "flaky", reads: BuilderWorld.world({ listDefinitions: FAILED }) },
      { name: "prod" },
    ])

    expect(only(model.rows)).toStrictEqual({
      kind: "incidentSummary",
      widget: board.rows[0]?.[0],
      engines: 3,
      known: 1,
      total: 3,
      rows: [{ engine: "shop", withIncident: 3 }, { engine: "flaky" }, { engine: "prod" }],
    })
  })

  test("lists the processes with an incident per engine, most first, and none it could not read", async () => {
    const board = BuilderWorld.board([{ widget: "incidentSummary" }], ["shop", "prod"])

    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "prod" },
    ])

    const tile = only(model.rows)
    expect(tile).toMatchObject({ kind: "incidentSummary", engines: 2, known: 1, total: 3 })
    expect(
      tile.kind === "incidentSummary" &&
        tile.rows.map((row) => [row.engine, row.process?.bpmnProcessId, row.withIncident]),
    ).toStrictEqual([
      ["shop", "pulse-order", 1],
      ["shop", "pulse-label", 1],
      ["shop", "pulse-dispatch", 1],
    ])
  })

  test("orders the processes by their instances with incident, most first, and leaves out those without", async () => {
    const counted: Readonly<Record<string, number>> = { "pulse-order": 2, "pulse-dispatch": 5 }
    const reads = BuilderWorld.world({
      listDefinitions: async () =>
        (await BuilderWorld.world().listDefinitions()).map((summary) => ({
          ...summary,
          withIncident: counted[summary.latest.bpmnProcessId] ?? 0,
        })),
    })
    const board = BuilderWorld.board([{ widget: "incidentSummary" }], ["shop"])

    const model = await BoardBuilder.build(board, [{ name: "shop", reads }])

    const tile = only(model.rows)
    expect(tile).toMatchObject({ kind: "incidentSummary", known: 1, total: 7 })
    expect(
      tile.kind === "incidentSummary" &&
        tile.rows.map((row) => [row.process?.bpmnProcessId, row.withIncident]),
    ).toStrictEqual([
      ["pulse-dispatch", 5],
      ["pulse-order", 2],
    ])
  })

  test("has no total when no engine answered", async () => {
    const board = BuilderWorld.board([{ widget: "incidentSummary" }], ["prod"])

    const model = await BoardBuilder.build(board, [{ name: "prod" }])

    expect(only(model.rows)).toStrictEqual({
      kind: "incidentSummary",
      widget: board.rows[0]?.[0],
      engines: 1,
      known: 0,
      rows: [],
    })
  })
})

describe("an incident list", () => {
  test("holds each engine's first incidents, says where more are open and where it read none", async () => {
    const board = BuilderWorld.board(
      [{ widget: "incidentList", props: { process: "pulse-order" } }, { widget: "incidentList" }],
      ["shop", "more", "flaky", "prod"],
    )
    const more = BuilderWorld.world({
      searchIncidents: () => Promise.resolve({ items: [], next: "page-2" as never }),
    })

    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "more", reads: more },
      { name: "flaky", reads: BuilderWorld.world({ searchIncidents: FAILED }) },
      { name: "prod" },
    ])

    const groups = (row: number) => {
      const tile = only(model.rows, row)
      return tile.kind === "incidentList"
        ? tile.groups.map((group) => [group.engine, group.incidents?.length, group.more])
        : []
    }
    expect(groups(0)).toStrictEqual([
      ["shop", 1, undefined],
      ["more", 0, true],
      ["flaky", undefined, undefined],
      ["prod", undefined, undefined],
    ])
    expect(groups(1)).toStrictEqual([
      ["shop", 2, undefined],
      ["more", 0, true],
      ["flaky", undefined, undefined],
      ["prod", undefined, undefined],
    ])
  })
})

describe("a process diagram", () => {
  test("holds the latest version and its counts per element, without the diagram itself", async () => {
    const board = BuilderWorld.board(
      [{ widget: "processDiagram", props: { engines: ["shop"], process: "pulse-order" } }],
      ["shop"],
    )

    const model = await BoardBuilder.build(board, [{ name: "shop", reads: BuilderWorld.world() }])

    const tile = only(model.rows)
    expect(tile).toMatchObject({
      kind: "processDiagram",
      engine: "shop",
      latest: { id: DefinitionId("pulse-order:2"), bpmnProcessId: "pulse-order", version: 2 },
    })
    expect(JSON.stringify(tile)).not.toContain("<")
    expect(tile.kind === "processDiagram" && tile.badges?.length).toBeGreaterThan(0)
  })

  test("says when the process is not deployed, and holds no counts it could not read", async () => {
    const board = BuilderWorld.board(
      [
        { widget: "processDiagram", props: { engines: ["shop"], process: "pulse-missing" } },
        { widget: "processDiagram", props: { engines: ["counts"], process: "pulse-order" } },
        { widget: "processDiagram", props: { engines: ["drawing"], process: "pulse-order" } },
        { widget: "processDiagram", props: { engines: ["flaky"], process: "pulse-order" } },
        { widget: "processDiagram", props: { engines: ["prod"], process: "pulse-order" } },
      ],
      ["shop", "counts", "drawing", "flaky", "prod"],
    )

    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "counts", reads: BuilderWorld.world({ getElementStatistics: FAILED }) },
      {
        name: "drawing",
        reads: BuilderWorld.world({ getDiagramXml: () => Promise.resolve(undefined) }),
      },
      { name: "flaky", reads: BuilderWorld.world({ listDefinitions: FAILED }) },
      { name: "prod" },
    ])

    const shown = model.rows.map((row) => {
      const tile = row[0]
      return tile?.kind === "processDiagram"
        ? [tile.engine, tile.notDeployed, tile.latest?.version, tile.badges]
        : []
    })
    expect(shown).toStrictEqual([
      ["shop", true, undefined, undefined],
      ["counts", undefined, 2, undefined],
      ["drawing", undefined, 2, undefined],
      ["flaky", undefined, undefined, undefined],
      ["prod", undefined, undefined, undefined],
    ])
    expect(model.rows.map((row) => Object.keys(row[0] ?? {}))).toStrictEqual([
      ["kind", "widget", "engine", "notDeployed"],
      ["kind", "widget", "engine", "latest"],
      ["kind", "widget", "engine", "latest"],
      ["kind", "widget", "engine"],
      ["kind", "widget", "engine"],
    ])
  })

  test("notes a diagram longer than the builder reads where its tile stands, named by its title, keeping the badges it read", async () => {
    const longest = 4 * 1024 * 1024
    const padded = (xml: string | undefined, length: number) =>
      `${xml ?? ""}${" ".repeat(length - (xml ?? "").length)}`
    const drawnAs = (length: number, named = true) => {
      const world = BuilderWorld.world()
      return BuilderWorld.world({
        getDiagramXml: async (id) => padded(await world.getDiagramXml(id), length),
        listDefinitions: async () =>
          (await world.listDefinitions()).map((summary) => {
            const { id, bpmnProcessId, version } = summary.latest
            return named ? summary : { ...summary, latest: { id, bpmnProcessId, version } }
          }),
      })
    }
    const diagram = (engine: string, title?: string) => ({
      widget: "processDiagram",
      props: { engines: [engine], process: "pulse-order", ...(title ? { title } : {}) },
    })
    const board = BuilderWorld.board(
      [diagram("whole"), diagram("cut"), diagram("cut", "Orders"), diagram("unnamed")],
      ["whole", "cut", "unnamed"],
    )

    const model = await BoardBuilder.build(board, [
      { name: "whole", reads: drawnAs(longest) },
      { name: "cut", reads: drawnAs(longest + 1) },
      { name: "unnamed", reads: drawnAs(longest + 1, false) },
    ])

    const note = (path: string, title: string, engine: string) =>
      ({ path, code: "diagramTooLong", values: { title, engine } }) as const
    const notes = [
      note("rows[1].row[0]", "Order fulfillment", "cut"),
      note("rows[2].row[0]", "Orders", "cut"),
      note("rows[3].row[0]", "pulse-order", "unnamed"),
    ]
    expect(model.notes).toStrictEqual(notes)
    const [whole, cut] = model.rows.map((row) => row[0])
    expect(whole).not.toHaveProperty("diagramTooLong")
    expect(cut).toMatchObject({ kind: "processDiagram", engine: "cut" })
    expect(cut?.kind === "processDiagram" && cut.badges?.length).toBeGreaterThan(0)
    const parsed = { path: "layout", code: "ignoredKey" } as const
    const data = BoardJson.of(model, { failureOf: () => ({ code: "unread" }), notes: [parsed] })
    expect(data.notes).toStrictEqual([parsed, ...notes])
    expect(data.rows[1]?.[0]).not.toHaveProperty("diagramTooLong")
  })

  test("notes nothing on a board whose diagrams the builder reads whole", async () => {
    const board = BuilderWorld.board(
      [{ widget: "processDiagram", props: { engines: ["shop"], process: "pulse-order" } }],
      ["shop"],
    )

    const model = await BoardBuilder.build(board, [{ name: "shop", reads: BuilderWorld.world() }])

    expect(model).not.toHaveProperty("notes")
  })

  test("reads no engine when the widget names none", async () => {
    const widget = { widget: "processDiagram", process: "pulse-order", engines: [] } as const

    const model = await BoardBuilder.build({ title: "Orders", engines: [], rows: [[widget]] }, [])

    expect(model.rows).toStrictEqual([[{ kind: "processDiagram", widget, engine: "" }]])
  })
})

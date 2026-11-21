/**
 * The engine contract's conformance kit over the MCP server's own Camunda 8 wire: the runtime the
 * server runs on a Camunda 8 engine (`runtimeOf` on what `resolveRuntimeEngine` resolves: c8-core's
 * `C8Runtime` over `createC8Connection`, its token source and its words), configured as an
 * operator configures it (a `camunda8` profile of ENGINES_JSON through the module's
 * configuration, its secret in the ENGINE_SECRET_* variable `auth.passwordEnv` or
 * `auth.clientSecretEnv` names), against a local cluster in Testcontainers
 * (c8-cluster.test-support.ts: `PULSE_ENGINE_IMAGE` names the `camunda/camunda` image,
 * `PULSE_C8_STORAGE` and `PULSE_C8_SECURITY` the leg), seeded with the kit's world through
 * c8-core's `C8WorldSeed` and the Zeebe diagrams of c8-core's world/. The read laws hold here as on
 * the C8 adapter's wire, the unreachable cluster at 127.0.0.1:9 included; c8-core's recorded board
 * (`C8_BOARD_ENGINE`), read through the board feed over the seeded world, shows every tile with
 * the numbers the kit's fake world gives and its recording holds; and no tool of the Camunda 7
 * REST API reaches the cluster: alone it registers none, beside a Camunda 7 engine the call-time
 * net refuses it as the default, with nothing sent.
 *
 * It skips on a Camunda 7 image and fails on an image of neither (engine-image.test-support.ts), so
 * CI's Engines legs, which start Camunda 7 engines, skip it: CI starts no Camunda 8 image until
 * the licence question of #531 has an answer, and a leg runs locally, one at a time:
 * `PULSE_ENGINE_IMAGE=camunda/camunda:8.10.9 PULSE_C8_SECURITY=oidc pnpm --fail-if-no-match
 * --filter @miragon/pulse-engine-connector test:engines` (Docker).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import { C8_BOARD_ENGINE, C8WorldSeed } from "@miragon/pulse-c8-core/testing"
import { BulkOperationId, DefinitionId, IncidentId, InstanceId } from "@miragon/pulse-engine-core"
import {
  type ConformanceHarness,
  ConformanceKit,
  type SeededWorld,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
} from "@miragon/pulse-engine-core/testing"
import { engineConfigSchema, engineModule } from "../../module.js"
import { createConfiguredEngineRegistry } from "../../plugin.js"
import type {
  EngineScreenData,
  InstanceScreenData,
  ProcessScreenData,
} from "@miragon/pulse-screens"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import {
  ENGINE_BOARD_DATA,
  ENGINE_OPEN_COCKPIT,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
} from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import type { BoardStartData } from "../../view-models.board.js"
import { runtimeOf } from "../engine/engine-runtime.js"
import { resolveRuntimeEngine } from "../engine/resolve-engine.js"
import { fakeWorldBoard } from "./compared-boards.test-support.js"
import {
  C8_SECURITY,
  C8_STORAGE,
  type C8Login,
  type RunningC8Cluster,
  seedEngineOf,
  startC8Cluster,
} from "./c8-cluster.test-support.js"
import { engineImageOf } from "./engine-image.test-support.js"

const ENGINE_IMAGE = engineImageOf(process.env.PULSE_ENGINE_IMAGE)
/** The engine the recorded board names: the profile the read laws and the board read. */
const ENGINE = C8_BOARD_ENGINE.engine
const UNREACHABLE_URL = "http://127.0.0.1:9/v2"
/** The variable the profile names for the reader's secret: the server reads it, the model never. */
const SECRET_VARIABLE = "ENGINE_SECRET_C8_READER"

/** The profile of the reader, as an operator writes it, and the variable that holds its secret. */
function profileOf(url: string, reader: C8Login) {
  const profile = { url, flavor: "camunda8" }
  switch (reader.type) {
    case "none":
      return { profile, secrets: {} }
    case "basic":
      return {
        profile: {
          ...profile,
          auth: { type: "basic", username: reader.username, passwordEnv: SECRET_VARIABLE },
        },
        secrets: { [SECRET_VARIABLE]: reader.password },
      }
    case "clientCredentials":
      return {
        profile: {
          ...profile,
          auth: {
            type: "clientCredentials",
            tokenEndpoint: reader.tokenEndpoint,
            clientId: reader.clientId,
            clientSecretEnv: SECRET_VARIABLE,
            audience: reader.audience,
          },
        },
        secrets: { [SECRET_VARIABLE]: reader.clientSecret },
      }
  }
}

/**
 * The module's configuration over the cluster: the reader's profile under the name the recorded
 * board gives the engine, an unreachable cluster beside it, and the recorded board's file in
 * ENGINE_BOARDS_DIR; `withCamunda7` adds a Camunda 7 engine nothing listens on and makes the
 * cluster the default.
 */
function configurationOf(cluster: RunningC8Cluster, boardsDir: string, withCamunda7 = false) {
  const { profile, secrets } = profileOf(cluster.url, cluster.reader)
  fs.writeFileSync(path.join(boardsDir, "orders.board.json"), C8_BOARD_ENGINE.text)
  return engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: {
        [ENGINE]: profile,
        unreachable: { url: UNREACHABLE_URL, flavor: "camunda8" },
        ...(withCamunda7 ? { shop: { url: "http://127.0.0.1:9/engine-rest" } } : {}),
      },
      ...(withCamunda7 ? { defaultProfile: ENGINE } : {}),
    }),
    ENGINE_BOARDS_DIR: boardsDir,
    ...secrets,
  })
}

function branded<Key extends string, Id>(
  ids: Readonly<Record<Key, string>>,
  brand: (id: string) => Id,
): Record<Key, Id> {
  const entries = Object.entries<string>(ids).map(([key, id]) => [key, brand(id)])
  return Object.fromEntries(entries) as Record<Key, Id>
}

/** A world diagram, read from c8-core's world/ in the repository. */
function worldDiagram(process: string): string {
  const file = new URL(`../../../../../c8/c8-core/world/${process}.bpmn`, import.meta.url)
  return fs.readFileSync(file, "utf8")
}

/** The kit's world, seeded by c8-core as the cluster's seeding login, its ids branded. */
async function seedWorld(cluster: RunningC8Cluster): Promise<SeededWorld> {
  const diagrams = Object.fromEntries(
    WORLD_DEPLOYMENTS.map(({ process }) => [process, worldDiagram(process)]),
  )
  const world = await C8WorldSeed.seed(seedEngineOf(cluster.url, cluster.seed), {
    deployments: WORLD_DEPLOYMENTS,
    instances: WORLD_INSTANCES,
    localVariable: WORLD_LOCAL_VARIABLE,
    diagrams,
  })
  return {
    definitionIds: branded(world.definitionIds, DefinitionId),
    instanceIds: branded(world.instanceIds, InstanceId),
    unknown: {
      definitionId: DefinitionId(world.unknown.definitionId),
      instanceId: InstanceId(world.unknown.instanceId),
      incidentId: IncidentId(world.unknown.incidentId),
      bulkOperationId: BulkOperationId(world.unknown.bulkOperationId),
    },
  }
}

/** The module's plugin over the configuration, as the server registers it: its tools by name. */
function serverOf(config: Record<string, unknown>) {
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  return {
    names: () => [...recording.tools.keys()],
    call: (name: string, args: Record<string, unknown>) => {
      const tool = recording.tool(name)
      return tool.call((tool.config.inputSchema as z.ZodObject).parse(args))
    },
  }
}

const textOf = (result: { content: readonly unknown[] }) =>
  result.content.map((part) => (part as { text?: string }).text ?? "").join("")

/** The started cluster, the server over it (alone, and beside a Camunda 7 engine) and the kit's harness. */
interface Suite {
  readonly server: ReturnType<typeof serverOf>
  readonly besideCamunda7: ReturnType<typeof serverOf>
  readonly harness: ConformanceHarness
}

describe.skipIf(ENGINE_IMAGE.dialect !== "c8")(
  `c8-core's runtime over the MCP server's Camunda 8 wire against ${ENGINE_IMAGE.name}, ${C8_STORAGE}, security ${C8_SECURITY}`,
  () => {
    let boardsDir: string | undefined
    let starting: Promise<RunningC8Cluster> | undefined
    let suite: Suite | undefined

    beforeAll(async () => {
      boardsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-c8-engine-"))
      starting = startC8Cluster(ENGINE_IMAGE.name)
      const cluster = await starting
      const config = configurationOf(cluster, boardsDir)
      const registry = createConfiguredEngineRegistry(engineConfigSchema.parse(config))
      const harness = {
        runtime: runtimeOf(resolveRuntimeEngine(ENGINE, registry)),
        unreachableRuntime: runtimeOf(resolveRuntimeEngine("unreachable", registry)),
        world: await seedWorld(cluster),
      }
      suite = {
        server: serverOf(config),
        besideCamunda7: serverOf(configurationOf(cluster, boardsDir, true)),
        harness,
      }
    })

    afterAll(async () => {
      if (boardsDir !== undefined) fs.rmSync(boardsDir, { recursive: true, force: true })
      const started = await starting?.catch(() => undefined)
      await started?.stop()
    })

    const prepared = (): Suite => {
      if (suite === undefined) throw new Error("the cluster did not start")
      return suite
    }

    new ConformanceKit(test).registerRuntimeLaws(() =>
      Promise.resolve().then(() => prepared().harness),
    )

    test("board: the feed's build of c8-core's recorded board reads every tile, with the numbers of the kit's world", async () => {
      const result = await prepared().server.call(ENGINE_BOARD_DATA, { board: "orders" })
      const data = feedPayload<BoardStartData>(result)
      expect(data.engines.map(({ state }) => state)).toEqual(["ready"])
      expect(BoardFigures.of(data)).toEqual(BoardFigures.of(await fakeWorldBoard(C8_BOARD_ENGINE)))
      // The recording still holds what the cluster answers; else record it again from this world.
      expect(BoardFigures.of(data)).toEqual(BoardFigures.of(C8_BOARD_ENGINE.expected as BoardData))
    })

    // The web app reads a Camunda 8 engine whole through these feeds (D10's point 5), the numbers
    // the C8 adapter's screens give over the same world (c8-conformance.engine.test.ts).
    test("screens: the web app's engine, process and instance screen feeds give the kit world's numbers", async () => {
      const { server, harness } = prepared()
      const read = async <Data>(feed: string, args: Record<string, unknown>) =>
        feedPayload<Data>(await server.call(feed, { engine: ENGINE, ...args }))
      const engine = await read<EngineScreenData>(ENGINE_SCREEN_PROCESSES_DATA, {})
      expect(ScreenFigures.engine(engine)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
      const process = await read<ProcessScreenData>(ENGINE_SCREEN_PROCESS_DATA, {
        process: "pulse-order",
      })
      expect(ScreenFigures.process(process)).toEqual(ScreenFigures.process(WORLD_SCREENS.process))
      const instance = await read<InstanceScreenData>(ENGINE_SCREEN_INSTANCE_DATA, {
        instance: harness.world.instanceIds["DSP-3001"],
      })
      expect(ScreenFigures.instance(instance)).toEqual(
        ScreenFigures.instance(WORLD_SCREENS.instance),
      )
    })

    test("no tool or cockpit view of the Camunda 7 REST API reaches the cluster: alone none registers, beside one the default refuses, nothing sent", async () => {
      const { server, besideCamunda7 } = prepared()
      expect(server.names()).not.toContain("engine_list_process_instances")
      expect(besideCamunda7.names()).toContain("engine_list_process_instances")
      const sent = vi.spyOn(globalThis, "fetch")
      try {
        const tool = await besideCamunda7.call("engine_list_process_instances", {})
        const view = await besideCamunda7.call(ENGINE_OPEN_COCKPIT, { view: "incidents" })
        for (const refusal of [tool, view]) {
          expect(textOf(refusal)).toMatch(
            new RegExp(`^\\[ENGINE_DIALECT_NOT_SERVED\\] Engine "${ENGINE}" is a Camunda 8 engine`),
          )
        }
        expect(sent).not.toHaveBeenCalled()
      } finally {
        sent.mockRestore()
      }
    })
  },
)

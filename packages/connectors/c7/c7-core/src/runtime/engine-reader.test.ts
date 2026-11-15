import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { EngineReader } from "./engine-reader.js"

const TELEMETRY = {
  product: { name: "Operaton BPM Runtime", version: "2.1.5", edition: "community" },
}
const NO_VALUES = { pathArgs: [], query: {} }

const failing =
  (failure: unknown): Route =>
  () => {
    throw failure
  }

function describedBy(routes: Readonly<Record<string, Route>>) {
  const port = fakePort(routes)
  return { port, described: new EngineReader(port).describe() }
}

describe("EngineReader", () => {
  it("describes the engine by the product and version its telemetry names, in one request", async () => {
    const { port, described } = describedBy({ getTelemetryData: () => TELEMETRY })
    expect(await described).toEqual({ product: "Operaton BPM Runtime", version: "2.1.5" })
    expect(port.calls).toEqual([{ operationId: "getTelemetryData", input: NO_VALUES }])
  })

  it.each([
    ["no telemetry", fakeFailure(404, "InvalidRequestException")],
    ["no telemetry endpoint", fakeFailure(404, "NotFoundException")],
  ])("falls back to the REST API's version for an engine with %s", async (_kind, failure) => {
    const { port, described } = describedBy({
      getTelemetryData: failing(failure),
      getRestAPIVersion: () => ({ version: "7.24.0" }),
    })
    expect(await described).toEqual({ product: "Camunda 7 REST API", version: "7.24.0" })
    expect(port.calls).toEqual([
      { operationId: "getTelemetryData", input: NO_VALUES },
      { operationId: "getRestAPIVersion", input: NO_VALUES },
    ])
  })

  it.each([
    ["a refusal", fakeFailure(401)],
    ["an engine failure", fakeFailure(500, "ProcessEngineException")],
    ["no engine answer", new Error("connection refused")],
  ])("rejects %s of the telemetry as it is, asking nothing more", async (_kind, failure) => {
    const { port, described } = describedBy({ getTelemetryData: failing(failure) })
    await expect(described).rejects.toBe(failure)
    expect(port.calls).toHaveLength(1)
  })

  it("rejects a failure of the version read as it is", async () => {
    const failure = fakeFailure(404, "NotFoundException")
    const { described } = describedBy({
      getTelemetryData: failing(fakeFailure(404)),
      getRestAPIVersion: failing(failure),
    })
    await expect(described).rejects.toBe(failure)
  })

  it.each([
    ["telemetry that is no object", [], "telemetry is not an object"],
    ["telemetry without a product", {}, "telemetry product is not an object"],
    ["a product without its name", { product: { version: "2.1.5" } }, "name is missing"],
    ["a product without its version", { product: { name: "Operaton" } }, "version is missing"],
  ])("fails %s as unexpected", async (_kind, answer, message) => {
    const { described } = describedBy({ getTelemetryData: () => answer })
    await expect(described).rejects.toBeInstanceOf(RuntimeError)
    await expect(described).rejects.toMatchObject({ failure: "unexpectedResponse", message })
  })

  it.each([
    ["an empty version answer", undefined, "version is not an object"],
    ["a version answer without its version", {}, "version is missing"],
  ])("fails %s as unexpected", async (_kind, answer, message) => {
    const { described } = describedBy({
      getTelemetryData: failing(fakeFailure(404)),
      getRestAPIVersion: () => answer,
    })
    await expect(described).rejects.toMatchObject({ failure: "unexpectedResponse", message })
  })
})

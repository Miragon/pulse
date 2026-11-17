import { describe, expect, test } from "vitest"
import { VersionFloor } from "../../src/reading/version-floor.js"
import { clientWith, TOPOLOGY } from "../support/fake-transport.js"

function floorOf(gatewayVersion: string) {
  const { camunda, client } = clientWith([{ route: "GET /topology", answer: { gatewayVersion } }])
  return { camunda, floor: new VersionFloor(client) }
}

describe("the version floor", () => {
  test("reads the cluster's version once", async () => {
    const { camunda, client } = clientWith([TOPOLOGY])
    const floor = new VersionFloor(client)

    expect(await floor.checked()).toBe("8.10.8")
    expect(await floor.checked()).toBe("8.10.8")
    expect(camunda.requests).toHaveLength(1)
  })

  test.each(["8.8.45", "7.24.0", "8.0.0"])("refuses a cluster on %s, by name", async (version) => {
    const { floor } = floorOf(version)

    await expect(floor.checked()).rejects.toMatchObject({
      name: "RuntimeError",
      failure: "misconfigured",
      message: `Pulse reads Camunda 8.9 or newer. This cluster runs ${version}.`,
    })
  })

  test.each(["8.9.0", "8.10.8", "9.0.1"])("reads a cluster on %s", async (version) => {
    expect(await floorOf(version).floor.checked()).toBe(version)
  })

  test("reads every digit of the major and the minor as one number", async () => {
    await expect(floorOf("08.8.1").floor.checked()).rejects.toMatchObject({
      failure: "misconfigured",
      message: "Pulse reads Camunda 8.9 or newer. This cluster runs 08.8.1.",
    })
    expect(await floorOf("8.09.0").floor.checked()).toBe("8.09.0")
  })

  test.each(["main-SNAPSHOT", "v8.8.0"])(
    "leaves a version it cannot read from its start, %s, to the cluster",
    async (version) => {
      expect(await floorOf(version).floor.checked()).toBe(version)
    },
  )

  test("asks again after a failure, so a fixed URL works without a reload", async () => {
    const { camunda, client } = clientWith([])
    const floor = new VersionFloor(client)

    await expect(floor.checked()).rejects.toMatchObject({
      failure: { kind: "answered", status: 404, title: "Not Found" },
    })
    await expect(floor.checked()).rejects.toBeDefined()
    expect(camunda.requests).toHaveLength(2)
  })
})

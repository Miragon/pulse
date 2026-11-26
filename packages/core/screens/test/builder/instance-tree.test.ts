import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

describe("the tree of an instance and the instances it called", () => {
  test("locates nothing through a chain of called instances that turns in a circle", () => {
    const a = InstanceId("a")
    const b = InstanceId("b")
    const detail = Instances.detail({
      calledInstances: [Instances.called(a, b), Instances.called(b, a)],
      incidents: [Instances.incident("lost", { instanceId: a })],
      waitStates: [Instances.wait({ instanceId: b })],
    })

    const model = InstanceScreen.of(Instances.facts(detail))

    expect(model.markers).toEqual([])
    expect(model.headline).toMatchObject({ code: "incidentInCalledInstance", elementId: null })
    expect(model.calls).toEqual([])
  })
})

import { describe, expect, test } from "vitest"
import { ElementLine } from "../../src/model/model/element-line.js"

describe("the line of an element", () => {
  test("is the line that declares its id", () => {
    expect(ElementLine.of('<a>\n<b id="Task_1">\n</b>', "Task_1")).toBe(2)
  })

  test("is the first line when the id is not written as expected", () => {
    expect(ElementLine.of("<a>\n<b id='Task_1'>", "Task_1")).toBe(1)
  })
})

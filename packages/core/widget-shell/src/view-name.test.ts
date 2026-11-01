import { afterEach, describe, expect, it } from "vitest"
import { readViewName, VIEW_NAME_GLOBAL, viewPrelude } from "./view-name.js"

const global = globalThis as Record<string, unknown>

afterEach(() => {
  delete global[VIEW_NAME_GLOBAL]
})

describe("viewPrelude", () => {
  it("sets the view's name on a global, as one statement ahead of the bundle", () => {
    expect(VIEW_NAME_GLOBAL).toBe("__pulseView")
    expect(viewPrelude("camunda7_show_job_panel")).toBe(
      'globalThis.__pulseView="camunda7_show_job_panel";\n',
    )
  })

  it("quotes the name as a JS string that can never close the inline script", () => {
    const name = 'a"b</script>\u2028c'
    const prelude = viewPrelude(name)
    expect(prelude).not.toContain("</script>")
    expect(prelude).not.toContain("\u2028")
    // The quoted part reads back as exactly the name.
    const quoted = prelude.slice(`globalThis.${VIEW_NAME_GLOBAL}=`.length, -";\n".length)
    expect(JSON.parse(quoted)).toBe(name)
  })
})

describe("readViewName", () => {
  it("reads what the prelude set", () => {
    global[VIEW_NAME_GLOBAL] = "demo_show_thing"
    expect(readViewName()).toBe("demo_show_thing")
  })

  it("is undefined without a prelude, for an empty name and for a non-string", () => {
    expect(readViewName()).toBeUndefined()
    global[VIEW_NAME_GLOBAL] = ""
    expect(readViewName()).toBeUndefined()
    global[VIEW_NAME_GLOBAL] = 42
    expect(readViewName()).toBeUndefined()
  })
})

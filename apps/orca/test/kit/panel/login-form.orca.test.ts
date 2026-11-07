import { mount, type TestPanel } from "orca/testing"
import { afterEach, expect, test } from "vitest"
import * as panel from "../../../src/panel/engines.js"
import { engineList, panelHost, sent, SHOP_DEV, SHOP_TEST } from "./panel-host.js"

const TREE = { role: "tree" }
const SAVE = { role: "button", text: "Save login" }
const TWO_ENGINES = engineList([SHOP_DEV, SHOP_TEST])
let view: TestPanel | undefined

async function mounted(host = panelHost({ "engines.list": TWO_ENGINES })): Promise<TestPanel> {
  view = await mount(panel, { host })
  return view
}

async function typeLogin(shown: TestPanel): Promise<void> {
  await shown.type({ label: "Username" }, "demo")
  await shown.type({ label: "Password" }, "s3cret")
}

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test("shows the login form when an engine that needs a login is selected", async () => {
  const shown = await mounted()

  await shown.selectItem(TREE, "engine|shop-test")

  expect(shown.summary()).toContain('Callout warning "Sign in to shop-test"')
  expect(shown.find(SAVE)?.disabled).toBe(true)
  expect(shown.refusals).toEqual([])
})

test("shows no login form for an engine without a login", async () => {
  const shown = await mounted()

  await shown.selectItem(TREE, "engine|shop-dev")

  expect(shown.find({ label: "Username" })).toBeNull()
})

test("saves the typed login and reloads the engines", async () => {
  const host = panelHost({ "engines.list": TWO_ENGINES, "engines.setCredentials": { ok: true } })
  const shown = await mounted(host)
  await shown.selectItem(TREE, "engine|shop-test")
  await typeLogin(shown)

  expect(shown.find(SAVE)?.disabled).toBe(false)
  await shown.press(SAVE)

  expect(sent(host, "engines.setCredentials")).toEqual([
    { engine: "shop-test", username: "demo", password: "s3cret" },
  ])
  expect(shown.find({ label: "Username" })).toBeNull()
  expect(sent(host, "engines.list")).toHaveLength(2)
  expect(shown.errors).toEqual([])
})

test("saves the login when Enter is pressed in the password", async () => {
  const host = panelHost({ "engines.list": TWO_ENGINES, "engines.setCredentials": { ok: true } })
  const shown = await mounted(host)
  await shown.post("engines.login", { engine: "shop-test" })
  await shown.type({ label: "Username" }, "demo")

  await shown.type({ label: "Password" }, "s3cret", { submit: true })

  expect(sent(host, "engines.setCredentials")).toHaveLength(1)
})

test("keeps the form and says so when the login could not be saved", async () => {
  const host = panelHost({ "engines.list": TWO_ENGINES, "engines.setCredentials": { ok: false } })
  const shown = await mounted(host)
  await shown.selectItem(TREE, "engine|shop-test")
  await typeLogin(shown)

  await shown.press(SAVE)

  expect(shown.find({ text: "Pulse couldn't save the login on this machine." })).not.toBeNull()
  expect(shown.valueOf({ label: "Username" })).toBe("demo")
})

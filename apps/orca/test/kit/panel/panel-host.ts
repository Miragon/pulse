import { mockHost, type MockHost, type MockRequests } from "orca/testing"
import type {
  ConfigurationProblem,
  EngineList,
  EngineRow,
  UserConfigRow,
} from "../../../src/protocol.js"

export const SHOP_DEV: EngineRow = {
  name: "shop-dev",
  description: "LOCAL · 3 with incident",
  active: true,
  writable: true,
  definitions: [
    { bpmnProcessId: "order", label: "Order fulfillment", description: "v3", withIncident: 2 },
    { bpmnProcessId: "invoice", label: "Invoice", description: "v1", withIncident: 0 },
  ],
}

export const SHOP_TEST: EngineRow = {
  name: "shop-test",
  description: "TEST · localhost:18091",
  active: false,
  writable: false,
  login: {
    identity: "Username",
    secret: "Password",
    sendsTo: "Pulse sends it to localhost:18091.",
  },
  definitions: [],
}

export const C8_SAAS: EngineRow = {
  name: "c8-saas",
  description: "bru-2.api.camunda.io",
  active: false,
  writable: false,
  login: {
    secret: "Client secret",
    sendsTo:
      "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api.camunda.io.",
  },
  definitions: [],
}

export const SIGN_IN_PROBLEM = {
  title: "Sign in to shop-test.",
  detail: "The engine answered 401.",
  needsCredentials: true,
}

export const NO_CLI_CONFIG: UserConfigRow = {
  path: "/home/me/.config/pulse-cli/config.json",
  named: false,
  present: false,
  openable: false,
}

export function engineList(
  engines: readonly EngineRow[],
  options: {
    readonly projectFile?: string
    readonly userConfig?: UserConfigRow
    readonly problems?: readonly ConfigurationProblem[]
  } = {},
): EngineList {
  return {
    projectFile: options.projectFile ?? "/work/shop/.pulse.json",
    userConfig: options.userConfig ?? NO_CLI_CONFIG,
    engines,
    problems: options.problems ?? [],
  }
}

export function panelHost(requests: MockRequests = {}): MockHost {
  return mockHost({
    requests: {
      "engines.list": engineList([SHOP_DEV]),
      "engines.watch": { again: false },
      "prompts.list": { prompts: [] },
      "boards.list": { boards: [] },
      "models.list": { models: [] },
      ...requests,
    },
  })
}

export function sent(host: MockHost, name: string): unknown[] {
  return host
    .callsOf("plugin.request")
    .map((params) => params as { readonly name: string; readonly input?: unknown })
    .filter((params) => params.name === name)
    .map((params) => params.input)
}

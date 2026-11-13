import { join } from "node:path"
import { APP_ROOT, REPO_ROOT } from "./files.js"

export const RUNTIME_VIEW_SOURCES = join(REPO_ROOT, "packages/core/runtime-view/src")

export const RUNTIME_VIEW_LAYERS = ["core", "host-kit", "model", "ports", "webview"]

export const HOST_SOURCES = join(APP_ROOT, "src")

export const HOST_LAYERS = ["host"]

export const WORDED_LAYERS: readonly (readonly [string, string])[] = [
  ...RUNTIME_VIEW_LAYERS.map((layer) => [layer, join(RUNTIME_VIEW_SOURCES, layer)] as const),
  ...HOST_LAYERS.map((layer) => [layer, join(HOST_SOURCES, layer)] as const),
]

export const WEBVIEW = join(RUNTIME_VIEW_SOURCES, "webview")

export const ENGINE_CORE_SOURCES = "packages/connectors/engine/engine-core/src"

export const SHOWN_PACKAGES: readonly (readonly [string, string])[] = [
  ["engine-core", ENGINE_CORE_SOURCES],
  ["the C7 adapter", "packages/connectors/c7/c7-adapter/src"],
  ["c7-core", "packages/connectors/c7/c7-core/src"],
  ["the transport", "packages/core/http/src"],
  ["the profile format", "packages/core/profile/src"],
]

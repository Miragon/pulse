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

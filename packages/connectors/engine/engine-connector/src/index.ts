// What a composition root wires: the module, the analytics lookups it shares, and the admin-only
// tool list a root's tests hold the toolsets to. Everything else stays inside the module.
export { engineModule, createBpmnXmlFetcher } from "./module.js"
export { configuredEngineIds } from "./configured-engine-ids.js"
export { ENGINE_ADMIN_ONLY_TOOLS } from "./lib/mcp/toolsets.js"

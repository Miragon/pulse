// What a composition root wires: the module and the admin-only tool list a root's tests hold the
// toolsets to. Everything else stays inside the module.
export { engineModule } from "./module.js"
export { ENGINE_ADMIN_ONLY_TOOLS } from "./lib/mcp/toolsets.js"

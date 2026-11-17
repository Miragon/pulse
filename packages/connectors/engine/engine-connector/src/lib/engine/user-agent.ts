/**
 * The User-Agent of the server's own wires that no SDK brings: the Camunda 8 wire
 * (c8-connection.ts) names the engine module, never the Camunda 7 SDK's client. release-please
 * keeps the version in lockstep with the package's (an extra-files entry of
 * release-please-config.json reads the marker on its line).
 */
export const USER_AGENT = "@miragon/pulse-engine-connector/0.27.1" // x-release-please-version

export const COMMAND = {
  refresh: "pulse.refresh",
  openDefinition: "pulse.openDefinition",
  openEngineOverview: "pulse.openEngineOverview",
  goToInstance: "pulse.goToInstance",
  switchEngine: "pulse.switchEngine",
  setCredentials: "pulse.setCredentials",
  openTargetsFile: "pulse.openTargetsFile",
  showRuntimeData: "pulse.showRuntimeData",
  openInstance: "pulse.openInstance",
} as const

export type CommandId = (typeof COMMAND)[keyof typeof COMMAND]

import type { IncidentRow, InstanceView } from "../protocol/index.js"

export class HandoverText {
  static of(view: InstanceView): string {
    const { instance, engine } = view
    const subject = instance.businessKey ?? instance.shortId
    return [
      `### ${subject} · ${instance.processName} v${instance.version}`,
      `Engine: ${engine.name} (${engine.environment}, ${engine.host})${engine.product === undefined ? "" : ` · ${engine.product}`}`,
      `Instance: \`${instance.id}\`${instance.businessKey === undefined ? "" : ` · business key \`${instance.businessKey}\``} · ${instance.state}`,
      `Definition: \`${instance.definitionId}\` (${instance.bpmnProcessId} v${instance.version})`,
      "",
      view.incidents.length === 0
        ? "No open incidents."
        : `${view.incidents.length} open incident(s):`,
      ...view.incidents.flatMap((incident) => HandoverText.incidentLines(incident)),
      "",
      `As of ${HandoverText.utc(view.asOf)}. Variables are left out on purpose.`,
    ].join("\n")
  }

  private static incidentLines(incident: IncidentRow): string[] {
    return [
      `- **${incident.typeLabel}** at \`${incident.elementId}\` since ${HandoverText.utc(incident.createdAt)}`,
      ...(incident.rootCause === undefined ? [] : [`  - Root cause: ${incident.rootCause}`]),
      `  - Message: ${incident.message}`,
      ...(incident.retriesLeft === undefined ? [] : [`  - Retries left: ${incident.retriesLeft}`]),
      ...(incident.job === undefined
        ? []
        : [
            `  - Job: \`${incident.job.id}\`${incident.job.type === undefined ? "" : ` (${incident.job.type})`}`,
          ]),
      ...(incident.inCalledInstance === undefined
        ? []
        : [
            `  - In called instance \`${incident.inCalledInstance.instanceId}\` of ${incident.inCalledInstance.bpmnProcessId}`,
          ]),
      `  - Incident: \`${incident.id}\` (${incident.engineType})`,
    ]
  }

  private static utc(timestamp: string | undefined): string {
    return timestamp === undefined
      ? "unknown"
      : `${timestamp.replace("T", " ").replace(/\.\d+Z$|Z$/, "")} UTC`
  }
}

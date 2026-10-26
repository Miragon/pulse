import { EngineCliArguments } from "./engine-cli-arguments.js"

export class WriteCommands {
  static retryIncident(incidentId: string): string[] {
    return [
      "retry",
      ...["--incident", EngineCliArguments.identifier(incidentId)],
      ...["--retries", "1"],
    ]
  }

  static setVariable(instanceId: string, name: string): string[] {
    return [
      "process-instance",
      "set-variable",
      ...["--body", "-"],
      "--",
      EngineCliArguments.identifier(instanceId),
      EngineCliArguments.variableName(name),
    ]
  }

  static modify(instanceId: string): string[] {
    return [
      "process-instance",
      "modify",
      ...["--body", "-"],
      "--",
      EngineCliArguments.identifier(instanceId),
    ]
  }

  static deleteInstancesAsync(): string[] {
    return ["process-instance", "delete-async", "--yes", ...["--body", "-"]]
  }

  static migrateInstancesAsync(): string[] {
    return ["migration", "execute-plan-async", "--yes", ...["--body", "-"]]
  }

  static suspendBatch(batchId: string): string[] {
    return ["batch", "suspend", EngineCliArguments.identifier(batchId)]
  }

  static deleteBatch(batchId: string): string[] {
    return ["batch", "delete", EngineCliArguments.identifier(batchId), "--yes", "--no-cascade"]
  }
}

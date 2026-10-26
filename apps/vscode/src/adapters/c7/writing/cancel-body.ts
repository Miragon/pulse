import type { CancelOptions, InstanceId } from "../../../contract/index.js"

export class CancelBody {
  static of(instanceIds: readonly InstanceId[], options: CancelOptions | undefined): string {
    return JSON.stringify({
      processInstanceIds: instanceIds,
      ...(options?.reason === undefined ? {} : { deleteReason: options.reason }),
      skipCustomListeners: false,
      skipSubprocesses: false,
      skipIoMappings: false,
    })
  }
}

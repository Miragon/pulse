import type { CancelOptions, InstanceId } from "@miragon/pulse-engine-core"

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

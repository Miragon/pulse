import type { CamundaClient, DefinitionView } from "../rest/index.js"

export class TaggedVersions {
  private readonly known = new Map<string, Promise<readonly DefinitionView[]>>()

  constructor(private readonly client: CamundaClient) {}

  of(bpmnProcessId: string, versionTag: string): Promise<readonly DefinitionView[]> {
    const key = JSON.stringify([bpmnProcessId, versionTag])
    const known = this.known.get(key)
    if (known !== undefined) {
      return known
    }
    const read = this.client.versionsTagged(bpmnProcessId, versionTag)
    this.known.set(key, read)
    return read
  }
}

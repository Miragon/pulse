import type { CamundaClient, ElementInstanceView } from "../rest/index.js"

const MOST_REMEMBERED = 10_000

export class ElementScopes {
  private readonly known = new Map<string, ElementInstanceView>()

  constructor(private readonly client: CamundaClient) {}

  async of(key: string): Promise<ElementInstanceView | undefined> {
    const known = this.known.get(key)
    if (known !== undefined) {
      return known
    }
    const element = await this.client.elementInstance(key)
    if (element !== undefined) {
      this.remember(element)
    }
    return element
  }

  private remember(element: ElementInstanceView): void {
    if (this.known.size >= MOST_REMEMBERED) {
      this.known.clear()
    }
    this.known.set(element.key, element)
  }
}

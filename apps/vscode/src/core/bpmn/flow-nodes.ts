const COMMENTS_AND_TEXT = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g
const TAG = /<(\/?)(?:[\w-]+:)?(\w+)\b((?:[^>"]|"[^"]*")*)>/g
const ID = /\sid="([^"]+)"/
const SOURCE = /\ssourceRef="([^"]+)"/
const TARGET = /\stargetRef="([^"]+)"/
const ATTACHED_TO = /\sattachedToRef="([^"]+)"/
const TRIGGERED_BY_EVENT = /\striggeredByEvent="true"/
const SCOPE_KINDS: ReadonlySet<string> = new Set([
  "process",
  "subProcess",
  "transaction",
  "adHocSubProcess",
])
const FLOW_NODE_KINDS: ReadonlySet<string> = new Set([
  "task",
  "userTask",
  "serviceTask",
  "scriptTask",
  "sendTask",
  "receiveTask",
  "manualTask",
  "businessRuleTask",
  "callActivity",
  "subProcess",
  "transaction",
  "adHocSubProcess",
  "startEvent",
  "endEvent",
  "intermediateCatchEvent",
  "intermediateThrowEvent",
  "boundaryEvent",
  "exclusiveGateway",
  "parallelGateway",
  "inclusiveGateway",
  "eventBasedGateway",
  "complexGateway",
])
const JOIN_KINDS: ReadonlySet<string> = new Set([
  "parallelGateway",
  "inclusiveGateway",
  "complexGateway",
])

interface FlowNode {
  readonly kind: string
  readonly scope?: string
  readonly attachedTo?: string
}

interface OpenTag {
  readonly kind: string
  readonly id: string
}

export class FlowNodes {
  private readonly nodes = new Map<string, FlowNode>()
  private readonly outgoing = new Map<string, string[]>()
  private readonly incoming = new Map<string, string[]>()
  private readonly multiInstance = new Set<string>()
  private readonly eventSubProcesses = new Set<string>()
  private readonly timers = new Set<string>()
  private readonly open: OpenTag[] = []

  static of(xml: string): FlowNodes {
    const nodes = new FlowNodes()
    for (const [, closing, kind = "", attributes = ""] of xml
      .replace(COMMENTS_AND_TEXT, "")
      .matchAll(TAG)) {
      if (closing === "/") {
        nodes.open.pop()
      } else {
        nodes.read(kind, attributes)
      }
    }
    return nodes
  }

  ids(): string[] {
    return [...this.nodes.keys()]
  }

  kindOf(id: string): string | undefined {
    return this.nodes.get(id)?.kind
  }

  attachedTo(id: string): string | undefined {
    return this.nodes.get(id)?.attachedTo
  }

  scopesAround(id: string): string[] {
    const scopes: string[] = []
    for (let scope = this.nodes.get(id)?.scope; scope !== undefined;) {
      scopes.push(scope)
      scope = this.nodes.get(scope)?.scope
    }
    return scopes
  }

  isSubProcess(id: string): boolean {
    return SCOPE_KINDS.has(this.kindOf(id) ?? "")
  }

  isMultiInstance(id: string): boolean {
    return [id, ...this.scopesAround(id)].some((scope) => this.multiInstance.has(scope))
  }

  hasTimer(id: string): boolean {
    return this.timers.has(id)
  }

  isInEventSubProcess(id: string): boolean {
    return [id, ...this.scopesAround(id)].some((scope) => this.eventSubProcesses.has(scope))
  }

  eventGatewayBefore(id: string): string | undefined {
    return this.incoming.get(id)?.find((source) => this.kindOf(source) === "eventBasedGateway")
  }

  joinsAfter(id: string): string[] {
    if (this.isSplit(id)) {
      return this.isJoin(id) ? [id] : []
    }
    return this.reachableFrom(id, (node) => !this.isSplit(node)).filter((node) => this.isJoin(node))
  }

  reachesAlongBranch(from: string, to: string): boolean {
    return this.reachableFrom(from, (node) => !JOIN_KINDS.has(this.kindOf(node) ?? "")).includes(to)
  }

  private isSplit(id: string): boolean {
    return JOIN_KINDS.has(this.kindOf(id) ?? "") && (this.outgoing.get(id)?.length ?? 0) > 1
  }

  private isJoin(id: string): boolean {
    return JOIN_KINDS.has(this.kindOf(id) ?? "") && (this.incoming.get(id)?.length ?? 0) > 1
  }

  private reachableFrom(start: string, passes: (node: string) => boolean): string[] {
    const seen = new Set<string>([start])
    const queue = [start]
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      const next = node === start || passes(node) ? this.successorsOf(node) : []
      for (const successor of next.filter((candidate) => !seen.has(candidate))) {
        seen.add(successor)
        queue.push(successor)
      }
    }
    return [...seen]
  }

  private successorsOf(id: string): string[] {
    const targets = this.outgoing.get(id) ?? []
    const scope = this.nodes.get(id)?.scope
    const leaves = targets.length === 0 && scope !== undefined && this.nodes.has(scope)
    return leaves ? (this.outgoing.get(scope) ?? []) : targets
  }

  private read(kind: string, attributes: string): void {
    const id = ID.exec(attributes)?.[1] ?? ""
    this.noteTag(kind, id, attributes)
    if (!attributes.trimEnd().endsWith("/")) {
      this.open.push({ kind, id })
    }
  }

  private noteTag(kind: string, id: string, attributes: string): void {
    const parent = this.open.at(-1)?.id ?? ""
    switch (kind) {
      case "sequenceFlow":
        this.noteFlow(attributes)
        return
      case "multiInstanceLoopCharacteristics":
        this.multiInstance.add(parent)
        return
      case "timerEventDefinition":
        this.timers.add(parent)
        return
      default:
        if (FLOW_NODE_KINDS.has(kind) && id !== "") {
          this.noteNode(kind, id, attributes)
        }
    }
  }

  private noteNode(kind: string, id: string, attributes: string): void {
    const scope = this.open.findLast((tag) => SCOPE_KINDS.has(tag.kind))?.id
    const attachedTo = ATTACHED_TO.exec(attributes)?.[1]
    this.nodes.set(id, {
      kind,
      ...(scope === undefined ? {} : { scope }),
      ...(attachedTo === undefined ? {} : { attachedTo }),
    })
    if (TRIGGERED_BY_EVENT.test(attributes)) {
      this.eventSubProcesses.add(id)
    }
  }

  private noteFlow(attributes: string): void {
    const source = SOURCE.exec(attributes)?.[1] ?? ""
    const target = TARGET.exec(attributes)?.[1] ?? ""
    this.outgoing.set(source, [...(this.outgoing.get(source) ?? []), target])
    this.incoming.set(target, [...(this.incoming.get(target) ?? []), source])
  }
}

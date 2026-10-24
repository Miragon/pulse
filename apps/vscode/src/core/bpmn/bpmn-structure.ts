const TAG = /<(\/?)(?:[\w-]+:)?(\w+)\b((?:[^>"]|"[^"]*")*)>/g;
const ID = /\sid="([^"]+)"/;
const BPMN_ELEMENT = /\sbpmnElement="([^"]+)"/;
const EXPANDED = /\sisExpanded="true"/;
const SOURCE = /\ssourceRef="([^"]+)"/;
const TARGET = /\stargetRef="([^"]+)"/;
const SUB_PROCESS_KINDS: ReadonlySet<string> = new Set([
  'subProcess',
  'transaction',
  'adHocSubProcess',
]);

interface SequenceFlow {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

interface Tag {
  readonly closing: boolean;
  readonly kind: string;
  readonly attributes: string;
}

export class BpmnStructure {
  private readonly parents = new Map<string, string>();
  private readonly expanded = new Set<string>();
  private readonly open: string[] = [];
  private readonly flows: SequenceFlow[] = [];
  private callActivities = false;

  static of(xml: string): BpmnStructure {
    const structure = new BpmnStructure();
    for (const [, closing, kind = '', attributes = ''] of xml.matchAll(TAG)) {
      structure.read({ closing: closing === '/', kind, attributes });
    }
    return structure;
  }

  static hasCallActivities(xml: string): boolean {
    return BpmnStructure.of(xml).callActivities;
  }

  flowsBetween(sources: ReadonlySet<string>, targets: ReadonlySet<string>): string[] {
    return this.flows
      .filter((flow) => sources.has(flow.source) && targets.has(flow.target))
      .map((flow) => flow.id);
  }

  collapsedAround(elementId: string): string[] {
    const around: string[] = [];
    for (let parent = this.parents.get(elementId); parent !== undefined;) {
      if (!this.expanded.has(parent)) {
        around.push(parent);
      }
      parent = this.parents.get(parent);
    }
    return around;
  }

  private read(tag: Tag): void {
    const subProcess = SUB_PROCESS_KINDS.has(tag.kind);
    if (tag.closing) {
      if (subProcess) {
        this.open.pop();
      }
      return;
    }
    this.note(tag);
    const id = ID.exec(tag.attributes)?.[1] ?? '';
    this.nest(id);
    if (subProcess && !tag.attributes.trimEnd().endsWith('/')) {
      this.open.push(id);
    }
  }

  private note(tag: Tag): void {
    this.callActivities ||= tag.kind === 'callActivity';
    if (tag.kind === 'sequenceFlow') {
      this.noteFlow(tag.attributes);
    }
    if (tag.kind === 'BPMNShape' && EXPANDED.test(tag.attributes)) {
      this.expanded.add(BPMN_ELEMENT.exec(tag.attributes)?.[1] ?? '');
    }
  }

  private noteFlow(attributes: string): void {
    this.flows.push({
      id: ID.exec(attributes)?.[1] ?? '',
      source: SOURCE.exec(attributes)?.[1] ?? '',
      target: TARGET.exec(attributes)?.[1] ?? '',
    });
  }

  private nest(id: string): void {
    const parent = this.open.at(-1) ?? '';
    if (id !== '' && parent !== '') {
      this.parents.set(id, parent);
    }
  }
}

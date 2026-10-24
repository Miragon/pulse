import type {
  BpmnProcessId,
  ElementId,
  Incident,
  IncidentId,
  ModelElement,
  ModelFile,
  SourceLocation,
} from '../../contract/index.js';
import { ModelXml } from '../drift/model-xml.js';
import type { LocalSources, PanelContext } from './panel-context.js';

export interface ElementLink {
  readonly model: ModelFile;
  readonly elementId: ElementId;
  readonly element?: ModelElement;
  readonly code?: SourceLocation;
  readonly differsFromDeployed: boolean;
}

export type ElementLinks = ReadonlyMap<IncidentId, ElementLink>;

export type LinkedElement = Pick<Incident, 'definition' | 'elementId'>;

type ModelLookup = Map<BpmnProcessId, Promise<ModelFile | undefined>>;

export class ModelLinks {
  constructor(private readonly context: PanelContext) {}

  async ofIncidents(incidents: readonly Incident[]): Promise<ElementLinks> {
    const sources = this.context.sources;
    if (sources === undefined || incidents.length === 0) {
      return new Map();
    }
    const models: ModelLookup = new Map();
    const links = await Promise.all(
      incidents.map(async (incident) => {
        const link = await this.linkOf(sources, models, incident);
        return link === undefined ? [] : [[incident.id, link] as const];
      }),
    );
    return new Map(links.flat());
  }

  async ofElement(element: LinkedElement): Promise<ElementLink | undefined> {
    const sources = this.context.sources;
    return sources === undefined ? undefined : this.linkOf(sources, new Map(), element);
  }

  async modelOf(bpmnProcessId: BpmnProcessId): Promise<ModelFile | undefined> {
    const sources = this.context.sources;
    return sources === undefined ? undefined : this.quietly(sources.models.modelOf(bpmnProcessId));
  }

  async openModel(model: ModelFile, elementId?: ElementId): Promise<void> {
    const element = elementId === undefined ? undefined : await this.elementIn(model, elementId);
    if (element === undefined || elementId === undefined) {
      this.context.effects.openModel({ uri: model.uri, line: 1 });
      return;
    }
    this.context.effects.openModel(element.location, elementId);
  }

  openCode(link: ElementLink): void {
    if (link.code !== undefined) {
      this.context.effects.openSource(link.code);
    }
  }

  private async linkOf(
    sources: LocalSources,
    models: ModelLookup,
    incident: LinkedElement,
  ): Promise<ElementLink | undefined> {
    const bpmnProcessId = incident.definition.bpmnProcessId;
    let lookup = models.get(bpmnProcessId);
    if (lookup === undefined) {
      lookup = this.quietly(sources.models.modelOf(bpmnProcessId));
      models.set(bpmnProcessId, lookup);
    }
    const model = await lookup;
    if (model === undefined) {
      return undefined;
    }
    const [element, deployedXml] = await Promise.all([
      this.elementIn(model, incident.elementId),
      this.context.diagrams.get(incident.definition.id),
    ]);
    const implementation = element?.configuration.implementation;
    const code =
      implementation === undefined
        ? undefined
        : await this.quietly(sources.code.locate(implementation));
    return {
      model,
      elementId: incident.elementId,
      ...(element === undefined ? {} : { element }),
      ...(code === undefined ? {} : { code }),
      differsFromDeployed: !ModelXml.same(model.xml, deployedXml),
    };
  }

  private elementIn(model: ModelFile, elementId: ElementId): Promise<ModelElement | undefined> {
    const sources = this.context.sources;
    return sources === undefined
      ? Promise.resolve(undefined)
      : this.quietly(sources.models.elementIn(model, elementId));
  }

  private async quietly<Value>(lookup: Promise<Value | undefined>): Promise<Value | undefined> {
    try {
      return await lookup;
    } catch {
      return undefined;
    }
  }
}

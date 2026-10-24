import type {
  BpmnProcessId,
  ElementConfiguration,
  ElementId,
  ModelElement,
  ModelFile,
  ModelSource,
  WorkspaceFiles,
} from '../../contract/index.js';
import type { ModdleElement, ParseResult } from 'bpmn-moddle';
import { ElementLine } from './element-line.js';
import { ErrorReader } from './error-reader.js';
import { ImplementationReader } from './implementation-reader.js';
import { MappingReader } from './mapping-reader.js';
import { ModelParser } from './model-parser.js';

const MODEL_GLOB = '**/*.bpmn';
const MAX_MODELS = 500;

export class BpmnModelSource implements ModelSource {
  private readonly parser = new ModelParser();

  constructor(private readonly files: WorkspaceFiles) {}

  async modelOf(bpmnProcessId: BpmnProcessId): Promise<ModelFile | undefined> {
    const uris = [...(await this.files.find(MODEL_GLOB, MAX_MODELS))].sort();
    for (const uri of uris) {
      const xml = await this.files.read(uri);
      if (await this.declares(xml, bpmnProcessId)) {
        return { uri, fileName: uri.slice(uri.lastIndexOf('/') + 1), bpmnProcessId, xml };
      }
    }
    return undefined;
  }

  async elementIn(model: ModelFile, elementId: ElementId): Promise<ModelElement | undefined> {
    const parsed = await this.parser.parse(model.xml);
    const element = parsed.elementsById[elementId];
    if (element === undefined) {
      return undefined;
    }
    return {
      location: { uri: model.uri, line: ElementLine.of(model.xml, elementId) },
      configuration: this.configurationOf(parsed, element),
    };
  }

  private async declares(xml: string, bpmnProcessId: BpmnProcessId): Promise<boolean> {
    if (!xml.includes(`id="${bpmnProcessId}"`)) {
      return false;
    }
    try {
      return (await this.parser.processIds(xml)).includes(bpmnProcessId);
    } catch {
      return false;
    }
  }

  private configurationOf(parsed: ParseResult, element: ModdleElement): ElementConfiguration {
    const implementation = ImplementationReader.of(element);
    return {
      ...(implementation === undefined ? {} : { implementation }),
      inputs: MappingReader.of(element, 'inputParameters'),
      outputs: MappingReader.of(element, 'outputParameters'),
      errors: ErrorReader.of(parsed, element),
    };
  }
}

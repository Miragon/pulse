import type { VariableMapping } from '../../contract/index.js';
import type { ModdleElement } from 'bpmn-moddle';
import { ModelParser } from './model-parser.js';

type Direction = 'inputParameters' | 'outputParameters';

const MAPPING_CONTAINERS: ReadonlySet<string> = new Set(['camunda:InputOutput', 'zeebe:IoMapping']);

export class MappingReader {
  static of(element: ModdleElement, direction: Direction): VariableMapping[] {
    return ModelParser.extensions(element)
      .filter((extension) => MAPPING_CONTAINERS.has(extension.$type))
      .flatMap((container) => ModelParser.elements(container, direction))
      .flatMap((parameter) => MappingReader.mappingOf(parameter));
  }

  private static mappingOf(parameter: ModdleElement): VariableMapping[] {
    const target = ModelParser.text(parameter, 'name') ?? ModelParser.text(parameter, 'target');
    if (target === undefined) {
      return [];
    }
    const source = ModelParser.text(parameter, 'value') ?? ModelParser.text(parameter, 'source');
    return [source === undefined ? { target } : { target, source }];
  }
}

import type { ErrorReference } from '../../contract/index.js';
import type { ModdleElement, ParseResult } from 'bpmn-moddle';
import { ModelParser } from './model-parser.js';

export class ErrorReader {
  static of(model: ParseResult, element: ModdleElement): ErrorReference[] {
    const definitions = [
      ...ErrorReader.boundaryDefinitions(model, element),
      ...ModelParser.extensions(element).filter(
        (extension) => extension.$type === 'camunda:ErrorEventDefinition',
      ),
    ];
    const references = definitions.flatMap((definition) => ErrorReader.referenceOf(definition));
    return ErrorReader.distinct(references);
  }

  private static boundaryDefinitions(model: ParseResult, element: ModdleElement): ModdleElement[] {
    return Object.values(model.elementsById)
      .filter(
        (candidate) =>
          candidate?.$type === 'bpmn:BoundaryEvent' &&
          (candidate.get('attachedToRef') as ModdleElement | undefined)?.id === element.id,
      )
      .flatMap((boundary) => ModelParser.elements(boundary, 'eventDefinitions'))
      .filter((definition) => definition.$type === 'bpmn:ErrorEventDefinition');
  }

  private static referenceOf(definition: ModdleElement): ErrorReference[] {
    const error = definition.get('errorRef') as ModdleElement | undefined;
    const code = ModelParser.text(error, 'errorCode');
    const name = ModelParser.text(error, 'name');
    if (code === undefined && name === undefined) {
      return [];
    }
    return [{ ...(code === undefined ? {} : { code }), ...(name === undefined ? {} : { name }) }];
  }

  private static distinct(references: readonly ErrorReference[]): ErrorReference[] {
    const seen = new Set<string>();
    return references.filter((reference) => {
      const key = `${reference.code ?? ''}|${reference.name ?? ''}`;
      const fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    });
  }
}

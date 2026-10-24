import type { DefinitionView, IncidentRow } from '../../core/protocol/index.js';
import type { ElementCode } from './code-button.js';

type LocalModel = DefinitionView['model'];

export class ElementCodes {
  static of(model: LocalModel, incidents: readonly IncidentRow[] = []): ElementCode[] {
    const codes = incidents.flatMap((row) =>
      row.model?.codeLabel === undefined
        ? []
        : [{ elementId: row.elementId, label: row.model.codeLabel }],
    );
    const selected = model?.code;
    const all = selected === undefined ? codes : [...codes, selected];
    return [...new Map(all.map((code) => [code.elementId, code])).values()];
  }
}

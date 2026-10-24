import type {
  VariableEditor as EditorKind,
  VariableRow,
} from '../../core/protocol/index.js';
import { JsonText } from '../format/json-text.js';

export type InputKind = Exclude<EditorKind, 'any'>;

export const WRITE_AS: readonly (readonly [InputKind, string])[] = [
  ['text', 'Text'],
  ['integer', 'Whole number'],
  ['decimal', 'Number'],
  ['boolean', 'True or false'],
  ['json', 'JSON'],
];

const QUOTED: ReadonlySet<EditorKind> = new Set(['text', 'date']);
const MAX_WAS_LENGTH = 40;

export class VariableEditorText {
  static initial(row: VariableRow, kind: InputKind): string {
    if (row.editor === 'any') {
      return kind === 'boolean' ? 'true' : '';
    }
    if (QUOTED.has(kind)) {
      return VariableEditorText.quotedText(row.valueJson) ?? '';
    }
    return kind === 'json' ? JsonText.pretty(row.valueJson) : row.valueJson;
  }

  static valueJsonOf(kind: InputKind, text: string): string {
    return QUOTED.has(kind) ? JSON.stringify(text) : JsonText.compact(text);
  }

  static was(row: VariableRow, kind: InputKind): string {
    const shown =
      row.valueJson.length > MAX_WAS_LENGTH
        ? `${row.valueJson.slice(0, MAX_WAS_LENGTH)}…`
        : row.valueJson;
    const writtenAs =
      row.editor === 'any'
        ? ` · written as ${WRITE_AS.find(([id]) => id === kind)?.[1] ?? kind}`
        : '';
    return `${row.type ?? 'Value'} · was ${shown}${writtenAs}`;
  }

  private static quotedText(valueJson: string): string | undefined {
    try {
      const value: unknown = JSON.parse(valueJson);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

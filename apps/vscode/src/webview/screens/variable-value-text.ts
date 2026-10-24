import type { VariableRow } from '../../core/protocol/index.js';
import { JsonText } from '../format/json-text.js';

const INLINE_LENGTH = 48;

export class VariableValueText {
  static isExpandable(row: VariableRow): boolean {
    const value = row.valueJson.trim();
    return value.length > INLINE_LENGTH || value.startsWith('{') || value.startsWith('[');
  }

  static readable(row: VariableRow): string {
    return row.truncated ? row.valueJson : JsonText.pretty(row.valueJson);
  }
}

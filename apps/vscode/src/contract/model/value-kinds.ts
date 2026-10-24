import type { ValueKind } from './read-models.js';

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const LITERALS: Readonly<Record<string, ValueKind>> = {
  true: 'boolean',
  false: 'boolean',
  null: 'null',
};

export class ValueKinds {
  static ofJson(valueJson: string): ValueKind {
    const text = valueJson.trim();
    if (text.startsWith('"')) {
      return 'string';
    }
    if (INTEGER.test(text)) {
      return 'integer';
    }
    if (DECIMAL.test(text)) {
      return 'decimal';
    }
    return LITERALS[text] ?? 'json';
  }
}

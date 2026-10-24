import { ValueKinds, type ValueKind } from '../../../contract/index.js';

const NUMBER_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>(['integer', 'decimal']);

type EngineForm = (text: string) => string | undefined;

export class EngineValues {
  private static readonly FORMS: ReadonlyMap<string, EngineForm> = new Map<string, EngineForm>([
    ['String', (text) => EngineValues.string(text)],
    ['Short', (text) => EngineValues.integer(text)],
    ['Integer', (text) => EngineValues.integer(text)],
    ['Long', (text) => EngineValues.integer(text)],
    ['Double', (text) => (NUMBER_KINDS.has(ValueKinds.ofJson(text)) ? text : undefined)],
    ['Boolean', (text) => (text === 'true' || text === 'false' ? text : undefined)],
    ['Date', (text) => EngineValues.date(text)],
    [
      'Json',
      (text) => (EngineValues.parsed(text) === undefined ? undefined : JSON.stringify(text)),
    ],
    ['Null', (text) => (text === 'null' ? text : undefined)],
  ]);

  static isWritable(type: string): boolean {
    return EngineValues.FORMS.has(type);
  }

  static formOf(type: string, text: string): string | undefined {
    return EngineValues.FORMS.get(type)?.(text);
  }

  static date(text: string): string | undefined {
    const value = EngineValues.parsed(text);
    const epochMillis = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isNaN(epochMillis)
      ? undefined
      : JSON.stringify(new Date(epochMillis).toISOString().replace('Z', '+0000'));
  }

  static parsed(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private static string(text: string): string | undefined {
    const value = EngineValues.parsed(text);
    return typeof value === 'string' ? JSON.stringify(value) : undefined;
  }

  private static integer(text: string): string | undefined {
    return ValueKinds.ofJson(text) === 'integer' ? text : undefined;
  }
}

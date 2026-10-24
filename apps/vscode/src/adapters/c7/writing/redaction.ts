import { EngineValues } from './engine-values.js';

const REDACTED = '‹value›';
const MIN_REDACTED_LENGTH = 3;

export class Redaction {
  static readonly NOTHING = new Redaction([]);

  constructor(private readonly secrets: readonly string[]) {}

  static ofValue(valueJson: string): Redaction {
    const text = valueJson.trim();
    const value = EngineValues.parsed(text);
    if (typeof value !== 'string') {
      return new Redaction([text]);
    }
    const engineDate = EngineValues.date(text);
    return new Redaction(
      engineDate === undefined
        ? [text, value]
        : [text, value, String(EngineValues.parsed(engineDate))],
    );
  }

  static ofText(text: string | undefined): Redaction {
    return text === undefined
      ? Redaction.NOTHING
      : new Redaction([text, text.trim(), JSON.stringify(text).slice(1, -1)]);
  }

  applyTo(message: string): string {
    return this.secrets
      .filter((secret) => secret.length >= MIN_REDACTED_LENGTH)
      .reduce((text, secret) => text.replaceAll(secret, REDACTED), message);
  }
}

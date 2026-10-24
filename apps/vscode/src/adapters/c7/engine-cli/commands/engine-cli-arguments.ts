import { EngineCliFailure } from '../engine-cli-failure.js';

const IDENTIFIER = /^[A-Za-z0-9_][\w.:-]*$/;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const MAX_NAME_LENGTH = 255;

export class EngineCliArguments {
  static identifier(value: string): string {
    if (!IDENTIFIER.test(value)) {
      throw EngineCliArguments.refused(`"${value}" as an identifier`);
    }
    return value;
  }

  static variableName(value: string): string {
    if (value === '' || value.length > MAX_NAME_LENGTH || CONTROL_CHARACTERS.test(value)) {
      throw EngineCliArguments.refused('The variable name');
    }
    return value;
  }

  private static refused(what: string): EngineCliFailure {
    return new EngineCliFailure(`${what} is not accepted`, { code: 'NOT_FOUND', exitCode: null });
  }
}

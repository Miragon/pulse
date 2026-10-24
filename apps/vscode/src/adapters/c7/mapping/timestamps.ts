import { IsoTimestamp } from '../../../contract/index.js';

const COMPACT_OFFSET = /([+-]\d{2})(\d{2})$/;

export class Timestamps {
  static fromEngine(value: string): IsoTimestamp {
    return IsoTimestamp(value.replace(COMPACT_OFFSET, '$1:$2'));
  }

  static optional(value: string | undefined): IsoTimestamp | undefined {
    return value === undefined ? undefined : Timestamps.fromEngine(value);
  }
}

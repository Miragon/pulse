import { ElementId } from '../model/ids.js';

const ELEMENT_TAG = /<bpmn:(\w+)\s[^>]*?\bid="([^"]+)"/g;
const HOLDS_TOKENS: ReadonlySet<string> = new Set([
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'scriptTask',
  'businessRuleTask',
  'manualTask',
  'callActivity',
  'subProcess',
  'intermediateCatchEvent',
  'boundaryEvent',
]);

export class FakeDiagramElements {
  static kindsOf(xml: string): ReadonlyMap<ElementId, string> {
    return new Map(
      [...xml.matchAll(ELEMENT_TAG)].map(([, kind, id]) => [ElementId(id ?? ''), kind ?? '']),
    );
  }

  static holdsTokens(kind: string): boolean {
    return HOLDS_TOKENS.has(kind);
  }
}

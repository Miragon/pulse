import type { DefinitionId, VersionSummary } from '../../contract/index.js';
import type { DiagramCache } from '../diagrams/diagram-cache.js';
import { ModelXml } from './model-xml.js';

const COMPARED_VERSIONS = 10;

export interface LocalModel {
  readonly fileName: string;
  readonly xml: string;
}

export type DriftFinding =
  | {
      readonly kind: 'matches';
      readonly definitionId: DefinitionId;
      readonly version: number;
      readonly latest: boolean;
    }
  | { readonly kind: 'differs'; readonly latestVersion: number };

export class ModelDrift {
  constructor(private readonly diagrams: DiagramCache) {}

  async compare(local: LocalModel, versions: readonly VersionSummary[]): Promise<DriftFinding> {
    const newest = versions[0]?.definition.version ?? 0;
    for (const { definition } of versions.slice(0, COMPARED_VERSIONS)) {
      if (ModelXml.same(await this.diagrams.get(definition.id), local.xml)) {
        return {
          kind: 'matches',
          definitionId: definition.id,
          version: definition.version,
          latest: definition.version === newest,
        };
      }
    }
    return { kind: 'differs', latestVersion: newest };
  }
}

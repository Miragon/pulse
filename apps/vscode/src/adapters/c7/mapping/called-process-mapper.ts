import {
  BpmnProcessId,
  ElementId,
  type CalledProcess,
  type DefinitionRef,
} from '../../../contract/index.js';
import type { DefinitionView } from '../engine-cli/index.js';
import type { CalledElement } from './called-element-mapper.js';
import type { Mapper } from './mapper.js';

export interface CallsOfDefinition {
  readonly callerId: string;
  readonly calledElements: readonly CalledElement[];
  readonly definitions: readonly DefinitionView[];
}

export class CalledProcessMapper implements Mapper<CallsOfDefinition, CalledProcess[]> {
  constructor(private readonly refs: Mapper<DefinitionView, DefinitionRef>) {}

  map(calls: CallsOfDefinition): CalledProcess[] {
    const caller = calls.definitions.find((definition) => definition.id === calls.callerId);
    return calls.calledElements.map((called) => {
      const definition = this.definitionStartedBy(called, calls.definitions, caller);
      return {
        elementId: ElementId(called.elementId),
        bpmnProcessId: BpmnProcessId(called.processKey),
        ...(definition === undefined ? {} : { definition: this.refs.map(definition) }),
      };
    });
  }

  private definitionStartedBy(
    called: CalledElement,
    definitions: readonly DefinitionView[],
    caller: DefinitionView | undefined,
  ): DefinitionView | undefined {
    const versions = definitions
      .filter((definition) => definition.key === called.processKey)
      .sort((left, right) => right.version - left.version);
    const binding = called.binding;
    switch (binding.kind) {
      case 'latest':
        return versions[0];
      case 'deployment':
        return versions.find(
          (version) =>
            version.deploymentId !== undefined && version.deploymentId === caller?.deploymentId,
        );
      case 'version':
        return versions.find((version) => version.version === binding.version);
      case 'versionTag':
        return versions.find((version) => version.versionTag === binding.versionTag);
    }
  }
}

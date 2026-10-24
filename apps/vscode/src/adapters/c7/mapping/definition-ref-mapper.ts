import { BpmnProcessId, DefinitionId, type DefinitionRef } from '../../../contract/index.js';
import { Present, type DefinitionView } from '../engine-cli/index.js';
import type { Mapper } from './mapper.js';

export class DefinitionRefMapper implements Mapper<DefinitionView, DefinitionRef> {
  map(definition: DefinitionView): DefinitionRef {
    return {
      id: DefinitionId(definition.id),
      bpmnProcessId: BpmnProcessId(definition.key),
      version: definition.version,
      ...Present.fields({ name: definition.name }),
    };
  }
}

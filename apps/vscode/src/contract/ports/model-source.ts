import type { BpmnProcessId, ElementId } from '../model/ids.js';
import type { ModelElement, ModelFile } from '../model/local-sources.js';

export interface ModelSource {
  modelOf(bpmnProcessId: BpmnProcessId): Promise<ModelFile | undefined>;
  elementIn(model: ModelFile, elementId: ElementId): Promise<ModelElement | undefined>;
}

import { ElementId, type DefinitionRef } from '../../contract/index.js';
import type { InstanceView } from '../protocol/index.js';
import { ModelFactsView } from '../views/model-facts-view.js';
import type { ElementLink, ModelLinks } from './model-links.js';

export class SelectedElement {
  private elementId: ElementId | undefined;
  private link: ElementLink | undefined;

  constructor(
    private readonly links: ModelLinks,
    private readonly republish: () => void,
  ) {}

  async select(definition: DefinitionRef, elementId: string): Promise<void> {
    const selected = ElementId(elementId);
    this.elementId = selected;
    this.link = undefined;
    this.republish();
    const link = await this.links.ofElement({ definition, elementId: selected });
    if (this.elementId === selected) {
      this.link = link;
      this.republish();
    }
  }

  decorate(view: InstanceView): InstanceView {
    const code = this.link === undefined ? undefined : ModelFactsView.codeOf(this.link);
    return view.model === undefined || code === undefined
      ? view
      : { ...view, model: { ...view.model, code } };
  }

  openCode(elementId: string): void {
    const link = this.link;
    if (link === undefined) {
      return;
    }
    if (link.elementId === elementId) {
      this.links.openCode(link);
    }
  }
}

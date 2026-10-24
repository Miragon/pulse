import type { CalledProcess, InstanceDetail } from '../../contract/index.js';
import type { CallLink } from '../protocol/index.js';
import { CallTargets, type CalledInstanceChoice, type CallTarget } from './call-targets.js';
import { Labels } from './labels.js';

const OPEN_FROM_DEFINITION = 'Open called process';
const OPEN_FROM_INSTANCE = 'Not called yet – open called process';

export class CallLinks {
  constructor(
    private readonly targets: CallTargets,
    private readonly openDefinitionLabel: string,
  ) {}

  static ofDefinition(calledProcesses: readonly CalledProcess[]): CallLinks {
    return new CallLinks(new CallTargets(calledProcesses), OPEN_FROM_DEFINITION);
  }

  static ofInstance(calledProcesses: readonly CalledProcess[], detail: InstanceDetail): CallLinks {
    return new CallLinks(new CallTargets(calledProcesses, detail), OPEN_FROM_INSTANCE);
  }

  static missingText(bpmnProcessId: string, engineName: string): string {
    return `${bpmnProcessId} isn't deployed on ${engineName}`;
  }

  links(engineName: string): CallLink[] {
    return this.targets
      .all()
      .map(({ elementId, target }) => this.linkOf(elementId, target, engineName));
  }

  private linkOf(elementId: string, target: CallTarget, engineName: string): CallLink {
    switch (target.kind) {
      case 'instances':
        return { elementId, label: this.instancesLabel(target.choices) };
      case 'definition': {
        const name = target.definition.name ?? target.definition.bpmnProcessId;
        return { elementId, label: `${this.openDefinitionLabel} ${name}` };
      }
      case 'missing':
        return {
          elementId,
          label: CallLinks.missingText(target.bpmnProcessId, engineName),
          missing: true,
        };
    }
  }

  private instancesLabel(choices: readonly CalledInstanceChoice[]): string {
    const [first] = choices;
    if (choices.length > 1 || first === undefined) {
      return `Choose one of ${choices.length} called instances`;
    }
    const { bpmnProcessId, id } = first.instance;
    return `Open called instance ${bpmnProcessId} ${Labels.shortId(id)}`;
  }
}

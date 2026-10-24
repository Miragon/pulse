import {
  BpmnProcessId,
  DefinitionId,
  IncidentId,
  InstanceId,
} from '../../contract/index.js';
import type { WebviewIntent } from '../protocol/index.js';
import { PanelLive } from '../refresh/panel-live.js';
import { Labels } from '../views/labels.js';
import type { PanelContext } from './panel-context.js';
import { Problems } from './problems.js';

export class CommonIntents {
  constructor(
    private readonly context: PanelContext,
    private readonly live: PanelLive,
  ) {}

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case 'openInstance':
        this.context.effects.openInstance(InstanceId(intent.instanceId), {
          toSide: intent.toSide,
        });
        return;
      case 'openDefinition':
        this.context.effects.openDefinition(
          BpmnProcessId(intent.bpmnProcessId),
          DefinitionId(intent.definitionId),
          { toSide: false },
        );
        return;
      case 'openIncidentDetails':
        await this.openIncidentDetails(IncidentId(intent.incidentId));
        return;
      case 'goBack':
        this.context.effects.goBack();
        return;
      case 'copy':
        this.context.effects.copyToClipboard(intent.text, intent.label);
        return;
      case 'editConnection':
        this.context.effects.editConnection();
        return;
      case 'setCredentials':
        this.context.effects.setCredentials();
        return;
      default:
        if (PanelLive.handles(intent)) {
          this.live.handle(intent);
        }
        return;
    }
  }

  private async openIncidentDetails(incidentId: IncidentId): Promise<void> {
    try {
      const details = await this.context.runtime.getIncidentDetails(incidentId);
      if (details === undefined) {
        this.context.effects.reportProblem(
          Problems.notFound(`The details of incident ${Labels.shortId(incidentId)}`),
        );
        return;
      }
      this.context.effects.showIncidentDetails(`Incident ${Labels.shortId(incidentId)}`, details);
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine));
    }
  }
}

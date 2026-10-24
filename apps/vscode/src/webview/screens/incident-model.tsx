import { Fragment } from 'preact';
import type { IncidentRow, ModelFacts } from '../../core/protocol/index.js';
import { glyphs } from '../components/lucide-glyphs.json';
import { Icon } from '../components/icon.js';
import { useHost } from '../host/host-context.js';

export function IncidentModelFacts({ model }: { readonly model: ModelFacts | undefined }) {
  if (model === undefined) {
    return null;
  }
  return (
    <>
      {model.settings.map((setting, index) => (
        <Fragment key={`${setting.label}-${index}`}>
          <dt>{setting.label}</dt>
          <dd>
            <code class="facts__code">{setting.value}</code>
          </dd>
        </Fragment>
      ))}
      <dt>Model</dt>
      <dd>
        {model.fileName}
        {model.differsFromDeployed === true && (
          <span class="facts__warning">· differs from the deployed version</span>
        )}
      </dd>
    </>
  );
}

export function IncidentModelActions({ incident }: { readonly incident: IncidentRow }) {
  const host = useHost();
  const model = incident.model;
  if (model === undefined) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        class="button button--secondary"
        title={`Open ${model.fileName} at this element`}
        onClick={() => {
          host.post({ type: 'openModel', incidentId: incident.id });
        }}
      >
        <Icon of={glyphs.Workflow} />
        Open in model
      </button>
      {model.codeLabel !== undefined && (
        <button
          type="button"
          class="button button--secondary"
          title={`Open ${model.codeLabel}`}
          onClick={() => {
            host.post({ type: 'openCode', incidentId: incident.id });
          }}
        >
          <Icon of={glyphs.FileCode} />
          Open code
        </button>
      )}
    </>
  );
}

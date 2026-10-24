import type { ElementBadge, InstanceScope } from '../../core/protocol/index.js';
import { CountBadge } from '../components/count-badge.js';
import { BadgeDescription, type BadgeVariant } from './badge-description.js';

export type BadgeFilter = (elementId: string, scope?: InstanceScope) => void;

export interface BadgeClusterProps {
  readonly badge: ElementBadge;
  readonly elementName: string;
  readonly stale: boolean;
  readonly onSelect: BadgeFilter;
}

const SCOPES: Readonly<Record<BadgeVariant, InstanceScope>> = {
  incident: 'withIncident',
  propagated: 'withIncident',
  running: 'running',
};

interface CountButtonProps extends BadgeClusterProps {
  readonly variant: BadgeVariant;
  readonly count: number;
}

function CountButton({ badge, elementName, stale, onSelect, variant, count }: CountButtonProps) {
  if (count === 0) {
    return null;
  }
  const description = BadgeDescription.of(variant, count, elementName);
  return (
    <button
      type="button"
      class="badge-cluster__count"
      data-scope={SCOPES[variant]}
      aria-label={description}
      title={description}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(badge.elementId, SCOPES[variant]);
      }}
    >
      <CountBadge variant={variant} count={count} stale={stale} />
    </button>
  );
}

export function BadgeCluster(props: BadgeClusterProps) {
  const { badge } = props;
  return (
    <span
      class="badge-cluster"
      role="group"
      aria-label={props.elementName}
      data-badge-for={badge.elementId}
    >
      <CountButton {...props} variant="incident" count={badge.incidents} />
      <CountButton {...props} variant="propagated" count={badge.incidentsInCalledInstances} />
      <CountButton {...props} variant="running" count={badge.running} />
    </span>
  );
}

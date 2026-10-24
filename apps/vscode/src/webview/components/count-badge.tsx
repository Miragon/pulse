import { glyphs } from './lucide-glyphs.json';
import { CountLabels } from '../format/count-labels.js';
import { Icon } from './icon.js';

type CountBadgeVariant = 'incident' | 'propagated' | 'running';

export interface CountBadgeProps {
  readonly variant: CountBadgeVariant;
  readonly count?: number;
  readonly stale?: boolean;
}

export function CountBadge({ variant, count, stale = false }: CountBadgeProps) {
  const withIcon = variant !== 'running';
  return (
    <span
      class={`count-badge count-badge--${variant}${stale ? ' count-badge--stale' : ''}`}
      data-variant={variant}
    >
      {withIcon && <Icon of={glyphs.CircleX} size={12} />}
      {count !== undefined && <span class="count-badge__count">{CountLabels.compact(count)}</span>}
    </span>
  );
}

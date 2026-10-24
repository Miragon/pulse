import type { WebviewIntent } from '../../core/protocol/index.js';
import { useHost } from '../host/host-context.js';
import { Icon } from './icon.js';

export interface HeaderButtonProps {
  readonly icon: string;
  readonly label: string;
  readonly title: string;
  readonly intent: WebviewIntent;
}

export function HeaderButton({ icon, label, title, intent }: HeaderButtonProps) {
  const host = useHost();
  return (
    <button
      type="button"
      class="button button--ghost button--compact"
      title={title}
      onClick={() => {
        host.post(intent);
      }}
    >
      <Icon of={icon} />
      <span class="button__label">{label}</span>
    </button>
  );
}

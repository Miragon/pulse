import { glyphs } from './lucide-glyphs.json';
import type { Tone } from '../../core/protocol/index.js';
import { Icon } from './icon.js';

export interface StatusAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface StatusBoxProps {
  readonly tone: Tone;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly actions?: readonly StatusAction[];
}

const GLYPHS: Readonly<Record<Tone, string>> = {
  info: glyphs.Info,
  warning: glyphs.TriangleAlert,
  danger: glyphs.CircleX,
};

export function StatusBox({ tone, title, detail, actions = [] }: StatusBoxProps) {
  return (
    <div class={`status-box status-box--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon of={GLYPHS[tone]} class="status-box__icon" />
      <div class="status-box__body">
        <p class="status-box__title">{title}</p>
        {detail !== undefined && <p class="status-box__detail">{detail}</p>}
      </div>
      {actions.length > 0 && (
        <div class="status-box__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              class="button button--secondary"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

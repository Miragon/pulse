import type { ComponentChildren } from 'preact';
import { CountLabels } from '../format/count-labels.js';
import { RovingKeys } from './roving-keys.js';

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly count: number;
}

export interface TabsProps<Id extends string> {
  readonly label: string;
  readonly items: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
  readonly aside?: ComponentChildren;
  readonly children: ComponentChildren;
}

export function Tabs<Id extends string>({
  label,
  items,
  selected,
  onSelect,
  aside,
  children,
}: TabsProps<Id>) {
  return (
    <div class="tabs">
      <div class="tabs__bar">
        <div
          class="tabs__list"
          role="tablist"
          aria-label={label}
          onKeyDown={(event) => {
            RovingKeys.move(
              event,
              items.map((item) => item.id),
              onSelect,
            );
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              data-key={item.id}
              aria-selected={item.id === selected}
              aria-controls={`tabpanel-${item.id}`}
              tabIndex={item.id === selected ? 0 : -1}
              class="tabs__tab"
              onClick={() => {
                onSelect(item.id);
              }}
            >
              {item.label}
              <span class="tabs__count">{CountLabels.exact(item.count)}</span>
            </button>
          ))}
        </div>
        {aside}
      </div>
      <div
        class="tabs__panel"
        role="tabpanel"
        id={`tabpanel-${selected}`}
        aria-labelledby={`tab-${selected}`}
      >
        {children}
      </div>
    </div>
  );
}

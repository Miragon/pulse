import type { ReactNode } from "react"
import { Tabs as KitTabs, TabsContent, TabsList, TabsTrigger } from "@miragon/pulse-ui"
import { CountLabels } from "../format/count-labels.js"

export interface TabItem<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly count: number
}

export interface TabsProps<Id extends string> {
  readonly label: string
  readonly items: readonly TabItem<Id>[]
  readonly selected: Id
  readonly onSelect: (id: Id) => void
  readonly aside?: ReactNode
  readonly children: ReactNode
}

const COUNT_PILL =
  "bg-background text-muted-foreground text-small rounded-pill inline-flex min-w-4 justify-center px-[5px] font-normal tabular-nums"

function TabTrigger<Id extends string>({
  item,
  selected,
  onSelect,
}: {
  readonly item: TabItem<Id>
  readonly selected: Id
  readonly onSelect: (id: Id) => void
}) {
  return (
    <TabsTrigger
      value={item.id}
      tabIndex={item.id === selected ? 0 : -1}
      onClick={() => {
        if (item.id !== selected) {
          onSelect(item.id)
        }
      }}
    >
      {item.label}
      <span className={COUNT_PILL}>{CountLabels.exact(item.count)}</span>
    </TabsTrigger>
  )
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
    <KitTabs
      value={selected}
      onValueChange={(value) => {
        const item = items.find((candidate) => candidate.id === value)
        if (item !== undefined && item.id !== selected) {
          onSelect(item.id)
        }
      }}
      className="h-full min-h-0 gap-0"
    >
      <div className="min-w-0 shrink-0" data-part="tab-bar">
        <TabsList variant="line" aria-label={label} aside={aside} tabIndex={-1}>
          {items.map((item) => (
            <TabTrigger key={item.id} item={item} selected={selected} onSelect={onSelect} />
          ))}
        </TabsList>
      </div>
      <TabsContent
        value={selected}
        tabIndex={undefined}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {children}
      </TabsContent>
    </KitTabs>
  )
}

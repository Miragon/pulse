import { ChevronDownIcon, CircleXIcon } from "lucide-react"
import { useId } from "react"
import {
  Button,
  Icon,
  SITUATION_TONES,
  StateLabel,
  TONE_ICON,
  cn,
  formatCount,
  type StateLabelState,
} from "@miragon/pulse-ui"
import type { CalledInstanceData, InstanceStateCode } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { CalledInstanceLink } from "./called-instance-link.js"

const STATES: Readonly<Record<InstanceStateCode, StateLabelState>> = {
  running: "running",
  suspended: "suspended",
  completed: "completed",
  terminated: "cancelled",
}

export interface CalledInstanceMenuProps {
  /** The engine the instance runs on, as the surface names it. */
  readonly engine: string
  /** The name of the call activity, as the surface knows it (else its id). */
  readonly elementName: string
  /** The instances it called (a call link's `instances`), those with an incident first. */
  readonly instances: readonly CalledInstanceData[]
  readonly slots: Pick<InstanceSlots, "Link">
}

/**
 * The anchor of one menu's popover, a dashed ident of its own: a name two menus shared would
 * place every popover at the last menu's button.
 */
function anchorOf(menuId: string): string {
  return `--called-menu-${menuId.replace(/[^\w-]/g, "")}`
}

/**
 * The instances a call activity called, behind one button on the page: each with its state, an
 * open incident where its tree has one, and a link by its process and short id. Where a call
 * activity called one instance, its call button opens that instance instead. The button's name
 * starts with the words it shows, and its popover sits at its own button (flipped inline where
 * the page has no room on its right).
 */
export function CalledInstanceMenu({
  engine,
  elementName,
  instances,
  slots,
}: CalledInstanceMenuProps) {
  const t = useInstanceWords()
  const menuId = useId()
  const anchor = anchorOf(menuId)
  const count = formatCount(instances.length)
  const label = t("called.menuLabel", { count, element: elementName })
  return (
    <div className="inline-flex" data-part="called-instance-menu">
      <Button
        type="button"
        variant="outline"
        style={{ anchorName: anchor }}
        popoverTarget={menuId}
        aria-label={label}
        title={label}
      >
        {t("called.menu", { count })}
        <Icon icon={ChevronDownIcon} />
      </Button>
      <div
        id={menuId}
        popover="auto"
        style={{
          positionAnchor: anchor,
          positionArea: "bottom span-right",
          positionTryFallbacks: "flip-inline",
        }}
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mt-1 rounded-md border px-3 py-2"
      >
        <ul className="flex flex-col gap-1" aria-label={label}>
          {instances.map((instance) => (
            <li key={instance.id} className="flex items-center gap-3 leading-6">
              <StateLabel state={STATES[instance.state]} />
              {instance.withIncident && (
                <span
                  className="inline-flex"
                  role="img"
                  aria-label={t("called.withIncident")}
                  title={t("called.withIncident")}
                >
                  <Icon
                    icon={CircleXIcon}
                    className={cn(TONE_ICON[SITUATION_TONES.openIncident])}
                  />
                </span>
              )}
              <CalledInstanceLink
                engine={engine}
                called={{ instanceId: instance.id, bpmnProcessId: instance.bpmnProcessId }}
                Link={slots.Link}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

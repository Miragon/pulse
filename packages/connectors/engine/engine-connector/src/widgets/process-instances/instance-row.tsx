import { formatNumber, NamedId, StateLabel, Td, VersionChip } from "@miragon/pulse-ui"
import { HandOffButton, ListRow } from "@miragon/pulse-widget-shell/widgets"
import type { ProcessInstanceRow } from "../../view-models.js"
import { useHandOff } from "../lib/hand-off.js"
import { InstanceLabel } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT } from "../../messages/use-t.js"
import { rootCauseHandOff } from "./hand-offs.js"

/**
 * The row's state on one line, as the webview's state cell: running or suspended, and an open
 * incident beside it, each a tone icon of its own shape and its word (never a pill, never a dot's
 * colour alone). In a region under 28rem (a phone-width chat) the incident shows its icon alone,
 * closer, its word for a screen reader and in its title, so the row's own state and the incident
 * stay clear of the pinned row actions without scrolling.
 */
function InstanceState({ row }: { row: ProcessInstanceRow }) {
  const t = useT()
  return (
    <span className="inline-flex max-w-full items-center gap-3 whitespace-nowrap @max-md:gap-1">
      {row.suspended ? (
        <StateLabel state="suspended">{t("processInstances.stateSuspended")}</StateLabel>
      ) : (
        <StateLabel state="running">{t("processInstances.stateRunning")}</StateLabel>
      )}
      {row.hasIncident && <StateLabel state="incident" iconOnlyBelow="md" />}
    </span>
  )
}

/**
 * One instance: the row opens it on a click or Enter and copies its id on Ctrl or Cmd with C (one
 * row convention, as the webview's lists); its process opens by its own link, and an instance with
 * an open incident offers the hand-off at the row's end, which opens nothing.
 */
export function InstanceRow({
  row,
  processDefinitionKey,
  engine,
  showProcessColumn,
  actions,
  onOpen,
  onOpenProcess,
}: {
  row: ProcessInstanceRow
  processDefinitionKey: string | null
  engine: string
  showProcessColumn: boolean
  /** The table has a column of row actions (a hand-off shows on one of its rows). */
  actions: boolean
  onOpen: (row: ProcessInstanceRow) => void
  onOpenProcess: (row: ProcessInstanceRow) => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <ListRow
      label={t("processInstances.rowLabel", { name: instanceName(row.id, row.businessKey) })}
      onOpen={() => onOpen(row)}
      copy={row.id}
    >
      <Td>
        {/* One instance label (#322 U13): the business key, the UUID a
            copyable chip beside it, never a three-line UUID. */}
        <InstanceLabel id={row.id} businessKey={row.businessKey} />
      </Td>
      <Td>
        <InstanceState row={row} />
      </Td>
      {showProcessColumn && (
        <Td>
          {row.processDefinitionKey ? (
            <button
              type="button"
              onClick={() => onOpenProcess(row)}
              className="text-link text-left hover:underline"
              // The name replaces the button's content for a screen reader, so the version goes in it.
              aria-label={
                row.version !== null
                  ? t("processInstances.openProcessVersionAria", {
                      key: row.processDefinitionName ?? row.processDefinitionKey,
                      version: formatNumber(row.version),
                    })
                  : t("processInstances.openProcessAria", {
                      key: row.processDefinitionName ?? row.processDefinitionKey,
                    })
              }
            >
              {/* The version on the quiet line: the column it had is the
                  width the process name needs in a chat. */}
              <NamedId
                name={row.processDefinitionName}
                id={row.processDefinitionKey}
                detail={[row.version !== null ? `v${row.version}` : null]}
              />
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>
      )}
      {!showProcessColumn && (
        <Td>
          {row.version !== null ? (
            <VersionChip version={row.version} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>
      )}
      {actions && (
        <Td align="right">
          {/* A row's actions are xs, so the row keeps the row height (28 px). */}
          {row.hasIncident && (
            <HandOffButton
              action="findCause"
              variant="icon"
              size="xs"
              prompt={ask(rootCauseHandOff(row, processDefinitionKey, engine))}
            />
          )}
        </Td>
      )}
    </ListRow>
  )
}

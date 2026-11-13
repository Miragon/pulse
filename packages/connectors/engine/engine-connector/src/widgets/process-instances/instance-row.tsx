import { formatNumber, NamedId, StateLabel, Td, VersionChip, DrillButton } from "@miragon/pulse-ui"
import { HandOffButton } from "@miragon/pulse-widget-shell/widgets"
import type { ProcessInstanceRow } from "../../view-models.js"
import { useHandOff } from "../lib/hand-off.js"
import { InstanceLabel } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT } from "../../messages/use-t.js"
import { rootCauseHandOff } from "./hand-offs.js"

/**
 * The row's state on one line, as the webview's state cell: running or suspended, and an open
 * incident beside it, each a tone icon of its own shape and its word (never a pill, never a dot's
 * colour alone).
 */
function InstanceState({ row }: { row: ProcessInstanceRow }) {
  const t = useT()
  return (
    <span className="inline-flex max-w-full items-baseline gap-3 whitespace-nowrap">
      {row.suspended ? (
        <StateLabel state="suspended">{t("processInstances.stateSuspended")}</StateLabel>
      ) : (
        <StateLabel state="running">{t("processInstances.stateRunning")}</StateLabel>
      )}
      {row.hasIncident && <StateLabel state="incident" />}
    </span>
  )
}

export function InstanceRow({
  row,
  processDefinitionKey,
  engine,
  showProcessColumn,
  onOpen,
  onOpenProcess,
}: {
  row: ProcessInstanceRow
  processDefinitionKey: string | null
  engine: string
  showProcessColumn: boolean
  onOpen: (row: ProcessInstanceRow) => void
  onOpenProcess: (row: ProcessInstanceRow) => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <tr>
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
      <Td align="right">
        {/* A row's actions are xs, so the row keeps the row height (28 px). */}
        <div className="inline-flex items-center justify-end gap-1">
          <DrillButton
            size="xs"
            onDrill={() => onOpen(row)}
            ariaLabel={t("processInstances.openInstanceAria", {
              name: instanceName(row.id, row.businessKey),
            })}
          >
            {t("processInstances.openButton")}
          </DrillButton>
          {row.hasIncident && (
            <HandOffButton
              action="findCause"
              variant="icon"
              size="xs"
              prompt={ask(rootCauseHandOff(row, processDefinitionKey, engine))}
            />
          )}
        </div>
      </Td>
    </tr>
  )
}

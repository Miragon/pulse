import {
  formatNumber,
  HandOffButton,
  Icon,
  NamedId,
  Td,
  VersionChip,
} from "@miragon/pulse-widget-shell/widgets"
import { TriangleAlert } from "lucide-react"
import {
  CountPill,
  StatusBadge,
  TONE_DOT,
  type ToneVariant,
  DrillButton,
} from "@miragon/mcp-toolkit-ui"
import type { ProcessInstanceRow } from "../../view-models.js"
import { useHandOff } from "../lib/hand-off.js"
import { InstanceLabel } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT } from "../../messages/use-t.js"
import { rootCauseHandOff } from "./hand-offs.js"

function rowTone(row: ProcessInstanceRow): ToneVariant {
  if (row.hasIncident) return "danger"
  if (row.suspended) return "warning"
  return "neutral"
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
  /** Undefined when the default routed it. */
  engine: string | undefined
  showProcessColumn: boolean
  onOpen: (row: ProcessInstanceRow) => void
  onOpenProcess: (row: ProcessInstanceRow) => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const tone = rowTone(row)
  return (
    <tr className="hover:bg-muted transition-colors">
      <Td>
        {/* One instance label (#322 U13): the business key, the UUID a
            copyable chip beside it — never a three-line UUID. */}
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
          <InstanceLabel id={row.id} businessKey={row.businessKey} />
        </span>
        {/* Where the State column hides (a narrow engine-wide list), the
            state still shows in words, never as the dot's colour alone. */}
        {showProcessColumn && row.suspended && (
          <span className="mt-1 flex @min-[48rem]:hidden">
            <StatusBadge tone="warning">{t("processInstances.stateSuspended")}</StatusBadge>
          </span>
        )}
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
      <Td>
        {row.suspended ? (
          <StatusBadge tone="warning">{t("processInstances.stateSuspended")}</StatusBadge>
        ) : (
          <span className="text-muted-foreground text-small">
            {t("processInstances.stateRunning")}
          </span>
        )}
      </Td>
      <Td align="right">
        {row.hasIncident ? (
          <CountPill tone="danger">
            <Icon icon={TriangleAlert} dense label={t("processInstances.hasIncident")} />
          </CountPill>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td align="right">
        <div className="inline-flex items-center justify-end gap-1">
          <DrillButton
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
              prompt={ask(rootCauseHandOff(row, processDefinitionKey, engine))}
            />
          )}
        </div>
      </Td>
    </tr>
  )
}

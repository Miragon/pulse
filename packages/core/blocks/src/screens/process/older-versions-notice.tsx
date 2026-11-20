import { ArrowUpRightIcon, InfoIcon } from "lucide-react"
import { StatusStrip, formatCount } from "@miragon/pulse-ui"
import type { OlderVersionsData } from "@miragon/pulse-screens"
import { useProcessWords } from "../../messages/process-words.js"

/** The notice's numbers and the older version it offers, the process screen's notice. */
export interface OlderVersionsNoticeData {
  readonly running: OlderVersionsData["running"]
  readonly withIncident: OlderVersionsData["withIncident"]
  readonly show: Pick<OlderVersionsData["show"], "id" | "version">
}

export interface OlderVersionsNoticeProps {
  readonly notice: OlderVersionsNoticeData
  /** Shows the newest older version that still runs. */
  readonly onShow: (show: OlderVersionsNoticeData["show"]) => void
}

/**
 * The strip over the latest version of a process that says how many instances still run on older
 * versions and how many of them with incident, and offers the newest of those versions.
 */
export function OlderVersionsNotice({ notice, onShow }: OlderVersionsNoticeProps) {
  const t = useProcessWords()
  const running = formatCount(notice.running)
  const title =
    notice.withIncident > 0
      ? t("older.titleWithIncident", { running, withIncident: formatCount(notice.withIncident) })
      : t("older.title", { running })
  return (
    <StatusStrip
      tone="info"
      icon={InfoIcon}
      title={title}
      actions={[
        {
          label: t("older.show", { version: notice.show.version }),
          icon: ArrowUpRightIcon,
          onClick: () => {
            onShow(notice.show)
          },
        },
      ]}
    />
  )
}

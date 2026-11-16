import type { BoardIdProps } from "@miragon/pulse-blocks"
import { IdText } from "@miragon/pulse-widget-shell/widgets"

/** The cockpit's id in a tile's cell: the short id, quiet, with its copy button (`IdText`). */
export function BoardId({ id }: BoardIdProps) {
  return <IdText value={id} className="text-muted-foreground" />
}

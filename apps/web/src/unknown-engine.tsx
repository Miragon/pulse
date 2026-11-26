import { ErrorState } from "@miragon/pulse-ui"
import {
  StartPageLink,
  WEB_PATHS,
  WidgetShell,
  type ViewComponent,
  type ViewMap,
} from "@miragon/pulse-widget-shell/widgets"
import { cockpitNamesEngine } from "@miragon/pulse-engine-connector/widgets"
import { useT } from "./messages/index.js"
import type { PageStart } from "./router/routes.js"

/**
 * An address that names an engine the server does not configure: the page's refused start in the
 * view's place, its title the page's one heading (and so the document's), its way on the start
 * page, as the view frame's refused start has it. It reads nothing and offers no Try again, since
 * no retry changes it.
 */
function UnknownEngine({ engine }: { engine: string }) {
  const t = useT()
  // A shell of its own, the state in the gutter, as the cockpit's one state of an engine sits.
  return (
    <WidgetShell>
      <ErrorState
        title={t("start.unknownEngine.title", { engine })}
        titleAs="h1"
        description={t("start.unknownEngine.description")}
        actions={<StartPageLink href={WEB_PATHS.app} />}
      />
    </WidgetShell>
  )
}

/**
 * The page's views at `start`. Where its address names an engine beyond the view tool's arguments
 * (an engine's own address, which the page starts on the landing: `startOf`), the view refuses a
 * start whose data does not name that engine (`cockpitNamesEngine`), as the tool refuses such an
 * engine at any other address of it: the cockpit never opens to fall back from it, so the address
 * stays and a reload says the same. Any other start shows the views as they are.
 */
export function viewsAt(views: ViewMap, start: PageStart): ViewMap {
  const engine = start.place?.engine
  const View = Object.hasOwn(views, start.view) ? views[start.view] : undefined
  if (typeof engine !== "string" || View === undefined) return views
  const Checked: ViewComponent<unknown> = ({ data }) =>
    cockpitNamesEngine(data, engine) ? (
      <View data={data as never} />
    ) : (
      <UnknownEngine engine={engine} />
    )
  return { ...views, [start.view]: Checked }
}

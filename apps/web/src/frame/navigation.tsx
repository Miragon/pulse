import type { ReactNode } from "react"
import { Icon, SideNav, SideNavGroup, SideNavItem, SideNavList, TONE_ICON } from "@miragon/pulse-ui"
import { isSessionEnded } from "@miragon/pulse-widget-shell/widgets"
import {
  Ban,
  ClipboardList,
  Cog,
  House,
  Layers,
  Server,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { useEngineList, type ListedEngines } from "../engine-list.js"
import { useT } from "../messages/index.js"
import { PageLink, type Navigate } from "../router/page-link.js"
import { urlOf, type Place } from "../router/routes.js"
import { placeOfSection, sectionAt, sectionsOf, type NavSection } from "./nav-sections.js"

/** An engine as the navigation shows it: its sections, else on boards only, or refused. */
interface NavEngine {
  readonly id: string
  readonly kind: "sections" | "boardsOnly" | "refused"
  readonly sections: readonly NavSection[]
}

/** The engines of one environment, in the order the list names them. */
interface NavEnvironment {
  readonly id: string
  readonly engines: NavEngine[]
}

/** The environment the server groups an engine in without one. */
const DEFAULT_ENVIRONMENT = "default"

/**
 * The engines by environment, first appearance first, the refused profiles after the engines as
 * the list names them: an engine whose dialect has sections on the web opens them, another one
 * shows on boards only.
 */
function environmentsOf(list: ListedEngines): NavEnvironment[] {
  const groups = new Map<string, NavEngine[]>()
  const add = (environment: string | undefined, engine: NavEngine) => {
    const id = environment ?? DEFAULT_ENVIRONMENT
    groups.set(id, [...(groups.get(id) ?? []), engine])
  }
  for (const { id, environment, dialect } of list.engines ?? []) {
    const sections = sectionsOf(dialect)
    add(environment, { id, kind: sections.length > 0 ? "sections" : "boardsOnly", sections })
  }
  for (const { id, environment } of list.refused ?? []) {
    add(environment, { id, kind: "refused", sections: [] })
  }
  return [...groups].map(([id, engines]) => ({ id, engines }))
}

/**
 * Whether the navigation offers the view across engines: where the cockpit offers it, two engines
 * or more that it reads whole (a refused profile counts, an engine on boards only does not).
 */
function offersFleet(environments: readonly NavEnvironment[]): boolean {
  const whole = environments
    .flatMap(({ engines }) => engines)
    .filter((e) => e.kind !== "boardsOnly")
  return whole.length > 1
}

const SECTION_ICONS: Readonly<Record<NavSection, LucideIcon>> = {
  processes: Workflow,
  incidents: TriangleAlert,
  jobs: Cog,
}

/** One entry: the router's link in the item's look, a new tab where the click asks for one. */
function Entry({
  href,
  navigate,
  current,
  icon,
  note,
  nested,
  children,
}: {
  href: string
  navigate: Navigate
  current: boolean
  icon: ReactNode
  note?: string
  nested?: ReactNode
  children: ReactNode
}) {
  return (
    <SideNavItem asChild current={current} icon={icon} note={note} nested={nested}>
      <PageLink href={href} navigate={navigate}>
        {children}
      </PageLink>
    </SideNavItem>
  )
}

/**
 * An engine's entry: its own address (its processes, or its one state where it has no section),
 * the same wherever the page is (the chat's engine switch keeps the open section, N7; an entry of
 * the navigation is a link that stays put), the open one with its sections under it; an engine on boards only says so, a refused profile
 * says so beside its warning (the landing's mark of a refused profile), and either one's entry is
 * its page while it is open.
 */
function EngineEntry({
  engine,
  place,
  navigate,
}: {
  engine: NavEngine
  place: Place
  navigate: Navigate
}) {
  const t = useT()
  const open = place.engine === engine.id
  const nested = open && engine.sections.length > 0 && (
    <SideNavList>
      {engine.sections.map((section) => (
        <Entry
          key={section}
          href={urlOf(placeOfSection(section, engine.id))}
          navigate={navigate}
          current={sectionAt(place) === section}
          icon={<Icon icon={SECTION_ICONS[section]} />}
        >
          {t(`nav.section.${section}`)}
        </Entry>
      ))}
    </SideNavList>
  )
  return (
    <Entry
      href={urlOf({ view: "overview", engine: engine.id })}
      navigate={navigate}
      current={open && engine.sections.length === 0}
      icon={
        engine.kind === "refused" ? (
          <Icon icon={Ban} className={TONE_ICON.warning} />
        ) : (
          <Icon icon={Server} />
        )
      }
      note={engine.kind === "sections" ? undefined : t(`nav.${engine.kind}`)}
      nested={nested || undefined}
    >
      {engine.id}
    </Entry>
  )
}

/** The engines, by environment where the server names environments; at least one environment. */
function Engines({
  environments,
  place,
  navigate,
}: {
  environments: readonly NavEnvironment[]
  place: Place
  navigate: Navigate
}) {
  const t = useT()
  const list = (engines: readonly NavEngine[]) => (
    <SideNavList>
      {engines.map((engine) => (
        <EngineEntry key={engine.id} engine={engine} place={place} navigate={navigate} />
      ))}
    </SideNavList>
  )
  // One group without a name of its own: the server names no environment.
  const [only] = environments
  const named = environments.length > 1 || only.id !== DEFAULT_ENVIRONMENT
  return (
    <SideNavGroup label={t("nav.engines")}>
      {named
        ? environments.map((environment) => (
            <SideNavGroup key={environment.id} label={environment.id}>
              {list(environment.engines)}
            </SideNavGroup>
          ))
        : list(only.engines)}
    </SideNavGroup>
  )
}

/**
 * The page's navigation, from the one read of the engine list (shared with the embedded cockpit,
 * so a page view costs no second read and no read per engine: the navigation carries no counts):
 * the start page, the view across engines where the cockpit offers it, the engines by environment
 * with the open one's sections, the server's boards. Every entry is a link of the page; the one
 * of the place on screen is current. `navigate` follows an entry in the page. Where the list
 * cannot be read, a quiet line says so; the session's end it leaves to the frame's notice.
 */
export function PageNavigation({ place, navigate }: { place: Place; navigate: Navigate }) {
  const t = useT()
  const { data, error } = useEngineList()
  // A page's ended session is the frame's notice to say, once: no line here repeats it.
  const failed = error !== null && !isSessionEnded(error)
  const environments = data === undefined ? [] : environmentsOf(data)
  const boards = data?.boards ?? []
  return (
    <SideNav ariaLabel={t("nav.label")}>
      <SideNavList>
        <Entry
          href={urlOf({ view: "landing" })}
          navigate={navigate}
          current={place.view === "landing"}
          icon={<Icon icon={House} />}
        >
          {t("nav.start")}
        </Entry>
        {offersFleet(environments) && (
          <Entry
            href={urlOf({ view: "fleet" })}
            navigate={navigate}
            current={place.view === "fleet"}
            icon={<Icon icon={Layers} />}
          >
            {t("nav.fleet")}
          </Entry>
        )}
      </SideNavList>
      {environments.length > 0 && (
        <Engines environments={environments} place={place} navigate={navigate} />
      )}
      {failed && (
        <p className="text-small text-muted-foreground px-gutter">{t("nav.enginesFailed")}</p>
      )}
      {boards.length > 0 && (
        <SideNavGroup label={t("nav.boards")}>
          <SideNavList>
            {boards.map((board) => (
              <Entry
                key={board.id}
                href={urlOf({ view: "board", board: board.id })}
                navigate={navigate}
                current={place.view === "board" && place.board === board.id}
                icon={<Icon icon={ClipboardList} />}
              >
                {board.title}
              </Entry>
            ))}
          </SideNavList>
        </SideNavGroup>
      )}
    </SideNav>
  )
}

import { createContext, useContext } from "react"

// The cockpit binds this to its client-side router, so a drill navigates without an LLM round-trip.
export type NavIntent =
  | { type: "overview" }
  | { type: "incidents" }
  | ({
      type: "cluster-detail"
      activityId: string
      incidentType: string
      messageSignature?: string
    } & Labelled)
  | ({ type: "process-detail"; processDefinitionKey: string } & Labelled)
  | { type: "process-instances"; processDefinitionKey?: string }
  | ({ type: "process-incidents"; processDefinitionKey: string } & Labelled)
  | ({ type: "instance-detail"; processInstanceId: string } & Labelled)
  | ({ type: "incident-detail"; incidentId: string } & Labelled)
  | { type: "jobs"; processDefinitionKey?: string; failedOnly?: boolean }

// #322 U13: the breadcrumb name; without one the drill shows the id.
interface Labelled {
  label?: string
}

export type OnNavigate = (intent: NavIntent) => void

// Every widget renders inside the cockpit, so the router is always there; widgets call `useNav()`
// instead of threading an `onNavigate` prop.
const NavContext = createContext<OnNavigate | null>(null)
export const NavProvider = NavContext.Provider

function navigationOutsideCockpit(): never {
  throw new Error("Navigation needs the cockpit's NavProvider.")
}

/** The cockpit's router. Outside it a drill throws: a silent no-op would hide a bug. */
export function useNav(): OnNavigate {
  return useContext(NavContext) ?? navigationOutsideCockpit
}

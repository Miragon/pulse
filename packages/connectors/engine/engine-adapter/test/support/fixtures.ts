import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8")
}

export const WORLD_IDS = {
  order1: "pulse-order:1:63b7b305-cd7f-11f1-86d2-667bc3771e0d",
  label1: "pulse-label:1:63b14a61-cd7f-11f1-86d2-667bc3771e0d",
  dispatch1: "pulse-dispatch:1:63c0659d-cd7f-11f1-86d2-667bc3771e0d",
  review: "63d65e9e-cd7f-11f1-86d2-667bc3771e0d",
  charge: "63d9e117-cd7f-11f1-86d2-667bc3771e0d",
  ended: "63de4df1-cd7f-11f1-86d2-667bc3771e0d",
  reviewV2: "63e2bad1-cd7f-11f1-86d2-667bc3771e0d",
  dispatch: "63e79cda-cd7f-11f1-86d2-667bc3771e0d",
  label: "63e7c3f0-cd7f-11f1-86d2-667bc3771e0d",
  chargeIncident: "63e2bad0-cd7f-11f1-86d2-667bc3771e0d",
  labelIncident: "63ebbba0-cd7f-11f1-86d2-667bc3771e0d",
  propagatedIncident: "63ebbba1-cd7f-11f1-86d2-667bc3771e0d",
  chargeJob: "63da7d5e-cd7f-11f1-86d2-667bc3771e0d",
  labelJob: "63e7eb04-cd7f-11f1-86d2-667bc3771e0d",
  externalTaskInstance: "c727b084-cd79-11f1-9d36-92016cbb8c45",
} as const

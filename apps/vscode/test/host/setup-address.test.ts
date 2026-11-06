import { describe, expect, test } from "vitest"
import { SetupAddress } from "../../src/adapters/c8/setup/setup-address.js"
import { ProfileUrl } from "../../src/host/connections/profile-url.js"

const ADDRESSES = [
  "https://camunda.example.com/v2",
  "https://camunda.example.com/v2/",
  "  http://localhost:18088/v2//  ",
  "https://camunda.example.com/v2?tenant=a",
  "https://camunda.example.com/v2#top",
  "https://user:secret@camunda.example.com/v2",
  "ftp://camunda.example.com/v2",
  "camunda.example.com/v2",
  "",
  "https://keycloak.example.com/realms/camunda/protocol/openid-connect/token?x=1",
  "https://keycloak.example.com/token#",
]

describe("the address rule the Camunda 8 setups keep their own copy of", () => {
  test.each(ADDRESSES)("reads %j as the host's profile parser does", (address) => {
    expect(SetupAddress.of(address)).toBe(ProfileUrl.of(address))
    expect(SetupAddress.asWritten(address)).toEqual(ProfileUrl.asWritten(address))
  })
})

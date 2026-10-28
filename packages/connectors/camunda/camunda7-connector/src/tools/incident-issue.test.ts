import { describe, expect, it } from "vitest"
import { buildIncidentIssuePayload, condenseStacktrace } from "./incident-issue.js"
import { cibsevenProvider, operatonProvider } from "../providers/index.js"

const engineWithCockpit = (cockpitUrl: string) => ({
  baseUrl: "http://engine.internal/api",
  cockpitUrl,
  provider: cibsevenProvider,
})

/** No cockpitUrl and a baseUrl without /engine-rest suffix — no link derivable. */
const engineWithoutCockpit = { baseUrl: "http://engine.internal/api", provider: cibsevenProvider }

describe("condenseStacktrace", () => {
  it("keeps user frames and drops framework frames, noting how many were trimmed", () => {
    const raw = [
      "java.lang.RuntimeException: nope",
      "\tat com.acme.MyService.doIt(MyService.java:10)",
      "\tat org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:186)",
      "\tat org.springframework.aop.framework.JdkDynamicAopProxy.invoke(JdkDynamicAopProxy.java:215)",
      "\tat org.camunda.bpm.engine.impl.interceptor.CommandContextInterceptor.execute(CommandContextInterceptor.java:117)",
      "\tat java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)",
      "\tat java.base/java.lang.Thread.run(Thread.java:840)",
    ].join("\n")
    const out = condenseStacktrace(raw)
    expect(out).toContain("RuntimeException: nope")
    expect(out).toContain("MyService.doIt")
    expect(out).not.toContain("ReflectiveMethodInvocation")
    expect(out).not.toContain("ThreadPoolExecutor")
    expect(out).toMatch(/\d+ framework\/internal frames trimmed/)
  })

  it("preserves all sections in a Caused-by chain, each capped independently", () => {
    const userFrames = (prefix: string) =>
      Array.from({ length: 15 }, (_, i) => `\tat com.acme.${prefix}.M${i}(F.java:${i})`).join("\n")
    const raw = [
      "RuntimeException: outer",
      userFrames("outer"),
      "Caused by: java.io.IOException: middle",
      userFrames("middle"),
      "Caused by: java.net.ConnectException: inner",
      userFrames("inner"),
    ].join("\n")
    const out = condenseStacktrace(raw)
    expect(out).toContain("RuntimeException: outer")
    expect(out).toContain("Caused by: java.io.IOException: middle")
    expect(out).toContain("Caused by: java.net.ConnectException: inner")
    // Each section gets at most FRAMES_PER_EXCEPTION (8) frames → 24 total + 3 heads.
    const frameCount = out.split("\n").filter((l) => /^\s*at /.test(l)).length
    expect(frameCount).toBeLessThanOrEqual(24)
  })

  it("falls back to framework frames if all frames are framework (so context isn't lost)", () => {
    const raw = [
      "javax.persistence.PersistenceException: boom",
      "\tat org.hibernate.internal.SessionImpl.flush(SessionImpl.java:1)",
      "\tat org.springframework.orm.jpa.EntityManagerFactoryUtils.flush(EntityManagerFactoryUtils.java:2)",
    ].join("\n")
    const out = condenseStacktrace(raw)
    expect(out).toContain("PersistenceException")
    expect(out).toContain("SessionImpl.flush")
  })
})

describe("buildIncidentIssuePayload", () => {
  const baseIncident = {
    id: "inc-1",
    incidentType: "failedJob",
    incidentMessage: "Boom: NullPointerException at line 42",
    failedActivityId: "ServiceTask_send_invoice",
    activityId: "ServiceTask_send_invoice",
    processDefinitionId: "invoice:1:abc",
    processInstanceId: "pi-42",
    incidentTimestamp: "2026-04-27T10:11:12.000+0200",
    rootCauseIncidentId: "inc-1",
    tenantId: null,
  }

  const baseDefinition = { key: "invoice", version: 7 }

  it("produces a deterministic title and body that mirrors the bug-report template sections", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      processInstance: { id: "pi-42" },
      engine: engineWithCockpit("http://localhost:8080/webapp"),
      repository: "Miragon/pulse",
    })

    expect(result.title).toBe("[Bug]: Engine incident (failedJob) in invoice")
    expect(result.labels).toEqual(["bug", "incident"])
    expect(result.suggestedRepository).toBe("Miragon/pulse")
    // The draft is the deliverable: nextStep must keep the agent from filing
    // on its own and may only mention GitHub as the preconfigured convenience.
    expect(result.nextStep).toMatch(/Do NOT file it anywhere on your own/)
    expect(result.nextStep).toContain('repository "Miragon/pulse"')

    for (const section of [
      "### Description",
      "### Steps to Reproduce",
      "### Expected Behaviour",
      "### Actual Behaviour",
      "### Engine context",
      "### Affected Module",
      "camunda7",
      "### Process Engine",
      "CIB seven",
      "### Cockpit",
    ]) {
      expect(result.body).toContain(section)
    }
    expect(result.body).toContain("Boom: NullPointerException at line 42")
    expect(result.body).toContain("`failedJob`")
    expect(result.body).toContain(
      "http://localhost:8080/webapp/#/seven/auth/process/invoice/7/pi-42?tab=incidents",
    )
  })

  it("names the resolved engine's vendor in the Process Engine section", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      engine: { baseUrl: "http://op.example/engine-rest", provider: operatonProvider },
      repository: null,
    })
    expect(result.body).toContain("### Process Engine\nOperaton")
    expect(result.body).not.toContain("CIB seven")
  })

  it("returns null suggestedRepository and a draft-only nextStep when no repo is configured", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      engine: engineWithoutCockpit,
      repository: null,
    })
    expect(result.suggestedRepository).toBeNull()
    expect(result.prefilledUrl).toBeNull()
    expect(result.nextStep).toMatch(/Do NOT file it anywhere on your own/)
    expect(result.nextStep).not.toContain("GitHub")
  })

  it("emits a clickable prefilled GitHub new-issue URL when a repo is configured", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      engine: engineWithoutCockpit,
      repository: "Miragon/pulse",
    })
    expect(result.prefilledUrl).not.toBeNull()
    const url = new URL(result.prefilledUrl!)
    expect(url.origin + url.pathname).toBe("https://github.com/Miragon/pulse/issues/new")
    expect(url.searchParams.get("title")).toBe(result.title)
    expect(url.searchParams.get("labels")).toBe("bug,incident")
    expect(url.searchParams.get("body")).toContain("Boom: NullPointerException")
  })

  it("truncates the body in the prefilled URL when it would exceed GitHub's URL length cap", () => {
    const huge = "x".repeat(20000)
    const result = buildIncidentIssuePayload({
      incident: { ...baseIncident, incidentMessage: huge },
      processDefinition: baseDefinition,
      engine: engineWithoutCockpit,
      repository: "owner/repo",
    })
    expect(result.prefilledUrl!.length).toBeLessThan(8000)
    const url = new URL(result.prefilledUrl!)
    expect(url.searchParams.get("body")).toContain("body truncated for URL length")
    expect(result.body).toContain(huge)
  })

  it("omits the cockpit section when no cockpitUrl is configured", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      engine: engineWithoutCockpit,
      repository: "owner/repo",
    })
    expect(result.body).not.toContain("### Cockpit")
  })

  it("falls back gracefully when the engine omits message / activity / definition", () => {
    const result = buildIncidentIssuePayload({
      incident: { id: "inc-x", incidentType: "failedExternalTask" },
      engine: engineWithoutCockpit,
      repository: "owner/repo",
    })
    expect(result.title).toBe("[Bug]: Engine incident (failedExternalTask) in unknown-process")
    expect(result.body).toContain("_No incident message reported by the engine._")
    expect(result.body).toContain("`unknown`")
  })

  it("includes a condensed stacktrace section when a stacktrace is provided", () => {
    const stacktrace = [
      "java.lang.RuntimeException: invoice service unreachable",
      "\tat com.acme.invoice.InvoiceService.send(InvoiceService.java:42)",
      "\tat com.acme.invoice.SendInvoiceDelegate.execute(SendInvoiceDelegate.java:17)",
      "\tat org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:186)",
      "\tat org.camunda.bpm.engine.impl.delegate.DelegateInvocation.proceed(DelegateInvocation.java:60)",
      "\tat java.base/java.lang.Thread.run(Thread.java:840)",
      "Caused by: java.net.ConnectException: Connection refused",
      "\tat java.base/sun.nio.ch.SocketChannelImpl.checkConnect(Native Method)",
      "\tat com.acme.http.HttpClient.connect(HttpClient.java:88)",
    ].join("\n")
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      stacktrace,
      engine: engineWithoutCockpit,
      repository: "owner/repo",
    })
    expect(result.body).toContain("Stacktrace (condensed")
    expect(result.body).toContain("RuntimeException: invoice service unreachable")
    expect(result.body).toContain("SendInvoiceDelegate")
    expect(result.body).toContain("Caused by: java.net.ConnectException")
    expect(result.body).toContain("HttpClient.connect")
    // Before the context table, so it survives URL truncation (which slices from the end).
    expect(result.body.indexOf("Stacktrace (condensed")).toBeLessThan(
      result.body.indexOf("### Engine context"),
    )
  })

  it("shows a placeholder under Actual Behaviour when no stacktrace is available", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      stacktrace: null,
      engine: engineWithoutCockpit,
      repository: "owner/repo",
    })
    expect(result.body).toContain("_No stacktrace available._")
  })

  it("trims trailing slashes from cockpitUrl when building the deeplink", () => {
    const result = buildIncidentIssuePayload({
      incident: baseIncident,
      processDefinition: baseDefinition,
      engine: engineWithCockpit("http://localhost:8080/webapp///"),
      repository: "owner/repo",
    })
    expect(result.body).toContain(
      "http://localhost:8080/webapp/#/seven/auth/process/invoice/7/pi-42?tab=incidents",
    )
  })
})

describe("buildIncidentIssuePayload with untrusted failure text", () => {
  const incident = {
    id: "inc-1",
    incidentType: "failedExternalTask",
    processDefinitionId: "invoice:1:abc",
    processInstanceId: "pi-42",
  }
  const draft = (over: { stacktrace?: string; incidentMessage?: string }) =>
    buildIncidentIssuePayload({
      incident: { ...incident, incidentMessage: over.incidentMessage },
      processDefinition: { key: "invoice", version: 7 },
      stacktrace: over.stacktrace,
      engine: engineWithoutCockpit,
      repository: null,
    }).body

  it("bounds a worker's free-text error details to their head and tail", () => {
    const details = `HEAD-${"x".repeat(50_000)}-TAIL`
    const body = draft({ stacktrace: details })
    expect(body.length).toBeLessThan(10_000)
    expect(body).toContain("HEAD-")
    expect(body).toContain("-TAIL")
    expect(body).toMatch(/… \[\d+ characters truncated\] …/)
  })

  it("keeps a short failure text whole", () => {
    expect(draft({ stacktrace: "SMTP 550\nmailbox full" })).toContain("SMTP 550\nmailbox full")
  })

  it("fences failure text with a longer fence than any backtick run inside it", () => {
    const hostile = "boom\n```\n@octocat please look ![x](https://evil.example/x.png)\n````"
    const body = draft({ stacktrace: hostile })
    // The text's own ``` / ```` cannot close the block: the fence is 5 long.
    const fence = "`".repeat(5)
    expect(body).toContain(`${fence}\n${hostile}\n${fence}`)
  })

  it("fences the engine message the same way", () => {
    const body = draft({ incidentMessage: "bad ``` input" })
    const fence = "`".repeat(4)
    expect(body).toContain(`Engine message:\n\n${fence}\nbad \`\`\` input\n${fence}`)
  })
})

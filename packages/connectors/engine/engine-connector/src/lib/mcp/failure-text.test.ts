import { describe, expect, it } from "vitest"
import { condenseStacktrace } from "./failure-text.js"

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

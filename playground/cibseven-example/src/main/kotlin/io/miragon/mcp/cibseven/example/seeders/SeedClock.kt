package io.miragon.mcp.cibseven.example.seeders

import org.cibseven.bpm.engine.impl.util.ClockUtil
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Date
import kotlin.random.Random

/**
 * Tiny wrapper around [ClockUtil] so seeders don't have to juggle `Date.from(...)`
 * everywhere. Also centralizes the user-task latency sampling used by both
 * process seeders.
 */
object SeedClock {

    /**
     * `true` while the seed has pinned [ClockUtil] to a fixed [Date]. Flipped
     * by [set] / [reset]. Read by [maybeAdvanceForActivity] so delegates can
     * call it unconditionally: the helper short-circuits to a no-op outside
     * seed mode, keeping production behavior unchanged.
     */
    @Volatile
    private var frozen: Boolean = false

    fun set(at: Instant) {
        ClockUtil.setCurrentTime(Date.from(at))
        frozen = true
    }

    fun reset() {
        ClockUtil.reset()
        frozen = false
    }

    /**
     * Long-tail completion latency in minutes: most tasks finish quickly, a
     * small fraction drags on for days. Same shape as the legacy seeder used,
     * kept here so both seeders share one realistic distribution.
     */
    fun sampleUserTaskLatencyMinutes(): Long {
        val roll = Random.nextDouble()
        return when {
            roll < 0.60 -> Random.nextLong(2, 120) // 2min–2h
            roll < 0.90 -> Random.nextLong(120, 12 * 60) // 2h–12h
            roll < 0.98 -> Random.nextLong(12 * 60, 72 * 60) // 12h–3d
            else -> Random.nextLong(72 * 60, 7 * 24 * 60) // 3d–7d outliers
        }
    }

    /**
     * Per-job latency sampled between every `executeJob` call so each
     * `camunda_activity_instances` row gets a non-zero `end_time - start_time`.
     * Without this the delegates run inside one transaction at a frozen clock
     * → all activity durations are 0 → bottleneck table and dashboard median
     * collapse to 0ms.
     */
    fun sampleServiceTaskLatencyMillis(): Long {
        val roll = Random.nextDouble()
        return when {
            roll < 0.70 -> Random.nextLong(50, 800)
            roll < 0.95 -> Random.nextLong(800, 5_000)
            else -> Random.nextLong(5_000, 30_000)
        }
    }

    /** Advance the simulated wall clock by [millis]. */
    fun advanceMillis(millis: Long) {
        val current = ClockUtil.getCurrentTime()?.toInstant() ?: Instant.now()
        ClockUtil.setCurrentTime(Date.from(current.plusMillis(millis)))
    }

    /**
     * Called from inside delegate bodies. When the clock is frozen (seed boot),
     * advances [ClockUtil] by a sampled service-task latency so the engine's
     * subsequent read for the activity's `endTime` returns a later instant
     * than the `startTime` it captured before the delegate ran. No-op when
     * unfrozen so production delegates pay nothing for this hook.
     */
    fun maybeAdvanceForActivity() {
        if (frozen) advanceMillis(sampleServiceTaskLatencyMillis())
    }

    fun randomInstantWithin(base: Instant, daysBack: Int): Instant = base.minus(
        Random.nextLong(0, daysBack.toLong() * 24 * 60),
        ChronoUnit.MINUTES,
    )
}

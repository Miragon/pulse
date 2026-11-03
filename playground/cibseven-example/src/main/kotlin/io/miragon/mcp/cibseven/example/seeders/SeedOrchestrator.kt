package io.miragon.mcp.cibseven.example.seeders

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.CommandLineRunner
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component

/**
 * Single entry point for Spring's CommandLineRunner: picks the active
 * [SeedProfile] from `seed.profile` and dispatches to every [ProcessSeeder]
 * that opts in for it. Keeps the legacy `seed` profile behavior-identical by
 * defaulting `seed.profile` to `DEFAULT` when not set.
 *
 * Job draining lives in [JobDrainer] (not here) so the seeders can inject it
 * without creating a constructor-injection cycle with the orchestrator.
 */
@Component
@Profile("seed", "seed-minimal", "seed-presentation")
class SeedOrchestrator(private val seeders: List<ProcessSeeder>, @Value("\${seed.profile:default}") private val profileValue: String) :
    CommandLineRunner {

    private val log = LoggerFactory.getLogger(SeedOrchestrator::class.java)

    override fun run(vararg args: String) {
        val profile = SeedProfile.fromString(profileValue)
        log.info("Seed orchestrator starting: profile={} seeders={}", profile, seeders.map { it.processKey })

        val active = seeders.filter { it.isActiveFor(profile) }
        if (active.isEmpty()) {
            log.warn("No seeders active for profile {}, nothing to seed.", profile)
            return
        }

        for (seeder in active) {
            log.info("Running seeder for processKey={}", seeder.processKey)
            seeder.seed(profile)
        }

        SeedClock.reset()
        log.info("Seed orchestrator done.")
    }
}

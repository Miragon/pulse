package io.miragon.mcp.cibseven.example.seeders

/**
 * One BPMN process → one seeder implementation. Each seeder decides whether it
 * contributes to a given [SeedProfile] (via [isActiveFor]) and how many
 * instances it wants to produce under that profile.
 */
interface ProcessSeeder {

    /** Human-readable key used in log lines; matches the BPMN processDefinitionKey. */
    val processKey: String

    fun isActiveFor(profile: SeedProfile): Boolean

    /** Run the seed for the given profile. Called by [SeedOrchestrator]. */
    fun seed(profile: SeedProfile)
}

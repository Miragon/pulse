plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.maven.publish)
}

// Group is the `io.miragon.mcp` umbrella inherited from the root build; the Gradle
// module name is the artifactId, so this publishes as
// `io.miragon.mcp:cibseven-history-metrics`.

dependencies {
    // Bundled into the plugin's transitive POM dependencies: the only runtime dep
    // consumers need to resolve; the engine/spring stack is `compileOnly` (provided).
    implementation(libs.micrometer.core)
    compileOnly(libs.spring.boot.starter)

    // CIB seven Engine SDK, provided at runtime by the engine. The contract test
    // drives real history events and a mocked engine, so tests need it too.
    compileOnly(libs.cibseven.engine)
    testImplementation(libs.cibseven.engine)

    // CommitBoundaryTest boots a real in-memory engine to prove that rolled-back
    // work is never counted.
    testImplementation(libs.h2)
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.jackson.databind)
    testImplementation(project(":konsist"))
}

// Publishes a thin jar (+ sources + javadoc) to the Sonatype Central Portal. Signing
// is gated on `-PsignArtifacts=true` so local / dry-run builds need no GPG key.
// Central Portal + signing credentials come from `ORG_GRADLE_PROJECT_*` env vars set
// by `publish-to-maven.yml`.
mavenPublishing {
    publishToMavenCentral()
    if (project.hasProperty("signArtifacts")) signAllPublications()
    coordinates("io.miragon.mcp", "cibseven-history-metrics", version.toString())

    pom {
        name.set("cibseven-history-metrics")
        description.set(
            "CIB seven history-event Micrometer metrics plugin powering the Pulse analytics module",
        )
        inceptionYear.set("2026")
        url.set("https://github.com/Miragon/pulse")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
                distribution.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("dominikhorn93")
                name.set("Dominik Horn")
                url.set("https://github.com/dominikhorn93")
                organization.set("Miragon")
                organizationUrl.set("https://miragon.io")
            }
        }
        scm {
            url.set("https://github.com/Miragon/pulse")
            connection.set("scm:git:git://github.com/Miragon/pulse.git")
            developerConnection.set("scm:git:ssh://git@github.com/Miragon/pulse.git")
        }
    }
}

tasks.test {
    // MetricsContractTest reads the shared Kotlin<->TS metric contract at
    // runtime. Declare the contract as a task input so a contract change
    // re-runs the otherwise up-to-date test task.
    inputs.file(rootProject.layout.projectDirectory.file("../packages/connectors/analytics/analytics-client/metrics-contract.json"))
        .withPathSensitivity(PathSensitivity.NONE)
}

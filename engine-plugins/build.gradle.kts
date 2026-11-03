plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.spring) apply false
    alias(libs.plugins.maven.publish) apply false
    alias(libs.plugins.ktlint) apply false
}

allprojects {
    // Umbrella group shared by every engine-plugin module; the engine is carried in
    // the artifactId (the Gradle module name, e.g. `cibseven-history-metrics`), so the
    // published coordinate is `io.miragon.mcp:<engine>-<artifact>`. Keeps one group as
    // more engines are added. `io.miragon` is the Sonatype Central namespace already
    // verified for the org (shared with bpmn-to-code); the Kotlin source package
    // matches it (`io.miragon.mcp.*`).
    group = "io.miragon.mcp"
    // version comes from gradle.properties, bumped in lockstep by release-please
    // (extra-file in the root release-please-config.json).

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "org.jlleitschuh.gradle.ktlint")

    configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        jvmToolchain(21)
    }

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        android.set(false)
        ignoreFailures.set(true) // Phase 1: warn-not-error, does not fail the build
        reporters {
            reporter(org.jlleitschuh.gradle.ktlint.reporter.ReporterType.PLAIN)
            reporter(org.jlleitschuh.gradle.ktlint.reporter.ReporterType.CHECKSTYLE)
        }
        filter {
            exclude("**/generated/**")
            exclude("**/build/**")
        }
    }

    dependencies {
        "implementation"(platform(rootProject.libs.spring.boot.bom))
        "testImplementation"(rootProject.libs.kotlin.test.junit5)
        "testRuntimeOnly"(rootProject.libs.junit.platform.launcher)
    }

    tasks.withType<JavaCompile> {
        sourceCompatibility = "21"
        targetCompatibility = "21"
    }

    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        compilerOptions {
            freeCompilerArgs.set(listOf("-Xjsr305=strict"))
        }
    }

    tasks.withType<Test> {
        useJUnitPlatform()
    }

    // Publishing to Maven Central (Sonatype Central Portal) is configured per
    // publishable module via the Vanniktech Maven Publish plugin; see
    // `cibseven-history-metrics/build.gradle.kts`. `konsist` is test-only and
    // applies no publishing. `publish-to-maven.yml` runs
    // `publishAndReleaseToMavenCentral` from the release train.
}

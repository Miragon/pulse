rootProject.name = "cibseven-example"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// The version catalog `libs` is gradle/libs.versions.toml, which Gradle reads by itself.
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        mavenCentral()
    }
}

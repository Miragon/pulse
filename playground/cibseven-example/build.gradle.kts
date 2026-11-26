plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

group = "io.miragon.mcp.cibseven.example"
version = "0.1.0"

kotlin {
    jvmToolchain(21)
    compilerOptions {
        freeCompilerArgs.set(listOf("-Xjsr305=strict"))
    }
}

dependencies {
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.jdbc)
    implementation(libs.cibseven.starter.rest)
    implementation(libs.cibseven.starter.webapp)

    // H2 in-memory database
    runtimeOnly(libs.h2)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.cibseven.bpm.junit5)
    testImplementation(libs.cibseven.bpm.assert)
    testImplementation(libs.kotlin.test.junit5)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// Spring Boot 4 / Jakarta EE 11 standardises on the `org.glassfish.jaxb` JAXB
// runtime (pulled in via Jersey). CIB seven's REST/webapp stack additionally
// drags in the legacy `com.sun.xml.bind` JAXB, the same 4.0.6 reference
// implementation under its old coordinate. Both produce a `jaxb-core-4.0.9.jar`,
// so `bootJar` aborts with a duplicate `BOOT-INF/lib` entry. Drop the legacy
// pair and keep the Jakarta runtime (this collision does not exist on Spring
// Boot 3.5, which is why it only surfaces with the Spring Boot 4 upgrade).
// CIB seven 3.0.0's webclient, org.cibseven.webapp:cibseven-webclient-web, is the
// Spring Boot 4 build, so it stays: it serves the web app under /webapp.
configurations.all {
    exclude(group = "com.sun.xml.bind", module = "jaxb-impl")
    exclude(group = "com.sun.xml.bind", module = "jaxb-core")
}

tasks.withType<JavaCompile> {
    sourceCompatibility = "21"
    targetCompatibility = "21"
}

tasks.withType<Test> {
    useJUnitPlatform()
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveFileName.set("cibseven-example.jar")
}

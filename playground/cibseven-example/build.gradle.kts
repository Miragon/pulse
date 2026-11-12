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
// implementation under its old coordinate. Both produce a `jaxb-core-4.0.6.jar`,
// so `bootJar` aborts with a duplicate `BOOT-INF/lib` entry. Drop the legacy
// pair and keep the Jakarta runtime (this collision does not exist on Spring
// Boot 3.5, which is why it only surfaces with the Spring Boot 4 upgrade).
configurations.all {
    exclude(group = "com.sun.xml.bind", module = "jaxb-impl")
    exclude(group = "com.sun.xml.bind", module = "jaxb-core")
    // CIB seven 2.2.0's `-4` webapp starter also drags in the Spring Boot 3.5
    // webclient (org.cibseven.webapp:cibseven-webclient-web, compiled against
    // Spring 6.2) alongside its `-spring-boot-4` replacement. That SB3 webclient
    // calls PathMatchConfigurer.setUseSuffixPatternMatch(), removed in Spring
    // Framework 7 (Spring Boot 4), so the app aborts on startup with a
    // NoSuchMethodError while building the welcomePageHandlerMapping bean.
    // Excluding it leaves the `-spring-boot-4` webclient in place; the app then
    // boots and the Cockpit/Tasklist webapp serves correctly (verified by running
    // it). Remove this once CIB seven's `-4` starter stops pulling the SB3 webclient.
    exclude(group = "org.cibseven.webapp", module = "cibseven-webclient-web")
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

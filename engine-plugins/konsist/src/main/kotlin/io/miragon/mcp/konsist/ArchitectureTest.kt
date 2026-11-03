package io.miragon.mcp.konsist

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.verify.assertTrue
import org.junit.jupiter.api.Test

/**
 * Shared architecture test base. Every consuming module extends this via an @Nested
 * inner class and passes its Gradle module name + root package. New rules land here
 * (or in sibling abstract classes) as conventions firm up; see engine-plugins/konsist/README.md.
 */
abstract class ArchitectureTest(private val moduleName: String, private val rootPackage: String) {
    @Test
    fun `every class resides in a declared package under the module root`() {
        Konsist
            .scopeFromModule(moduleName)
            .classesAndInterfacesAndObjects()
            .assertTrue { it.resideInPackage("$rootPackage..") }
    }
}

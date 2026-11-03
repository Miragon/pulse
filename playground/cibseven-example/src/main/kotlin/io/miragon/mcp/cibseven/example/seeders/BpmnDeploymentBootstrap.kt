package io.miragon.mcp.cibseven.example.seeders

import org.cibseven.bpm.engine.RepositoryService
import org.slf4j.LoggerFactory
import org.springframework.boot.CommandLineRunner
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/**
 * Deploys the miraveloLeasing BPMN files in two separate deployments so they
 * register as v1 and v2 of the same processDefinitionKey. Camunda's atomic
 * deployment rejects two definitions sharing one key, so the auto-deployer
 * (which bundles every `*.bpmn` resource into one deployment) cannot do this
 * for us, so we deploy explicitly here instead.
 *
 * Runs before [SeedOrchestrator] (lower @Order) so the seeder finds both
 * versions when it queries by `processDefinitionVersion`.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class BpmnDeploymentBootstrap(private val repositoryService: RepositoryService) : CommandLineRunner {

    private val log = LoggerFactory.getLogger(BpmnDeploymentBootstrap::class.java)

    override fun run(vararg args: String) {
        // Skip when v1 is already on the engine; keeps idempotency for hot
        // restarts against a populated database.
        val v1Already = repositoryService.createProcessDefinitionQuery()
            .processDefinitionKey("miraveloLeasing")
            .processDefinitionVersion(1)
            .singleResult()
        if (v1Already == null) {
            repositoryService.createDeployment()
                .name("miravelo-leasing-v1")
                .addClasspathResource("miravelo-leasing.bpmn")
                .addClasspathResource("miravelo-creditworthiness.bpmn")
                .deploy()
            log.info("Deployed miraveloLeasing v1 + assessCreditworthiness")
        } else {
            log.info("miraveloLeasing v1 already deployed, skipping")
        }

        val v2Already = repositoryService.createProcessDefinitionQuery()
            .processDefinitionKey("miraveloLeasing")
            .processDefinitionVersion(2)
            .singleResult()
        if (v2Already == null) {
            repositoryService.createDeployment()
                .name("miravelo-leasing-v2")
                .addClasspathResource("miravelo-leasing-v2.bpmn")
                .deploy()
            log.info("Deployed miraveloLeasing v2")
        } else {
            log.info("miraveloLeasing v2 already deployed, skipping")
        }
    }
}

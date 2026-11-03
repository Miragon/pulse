FROM eclipse-temurin:25-jre

WORKDIR /app

# Metrics ship via the app-internal Micrometer OTLP registry
# (management.otlp.metrics.export in application.yml), no OTEL Java agent.
COPY build/libs/cibseven-example.jar app.jar

EXPOSE 8410

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]

FROM eclipse-temurin:25-jre

WORKDIR /app

COPY build/libs/cibseven-example.jar app.jar

EXPOSE 8410

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]

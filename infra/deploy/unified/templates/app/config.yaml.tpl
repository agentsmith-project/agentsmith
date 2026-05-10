apiVersion: v1
kind: ConfigMap
metadata:
  name: agentsmith-app-config
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  AGENTSMITH_DEPLOY_PROFILE: "{{PROFILE}}"
  PUBLIC_BASE_URL: "{{PUBLIC_BASE_URL}}"
  PUBLIC_API_BASE_URL: "{{PUBLIC_API_BASE_URL}}"
  NEXT_PUBLIC_API_BASE: "{{PUBLIC_API_BASE_URL}}"
  RUNNER_PUBLIC_API_BASE_URL: "{{RUNNER_PUBLIC_API_BASE_URL}}"
  INTERNAL_API_BASE_URL: "http://agentsmith-api:20000/api/v1"
  AGENT_EXECUTION_HTTP_BASE_URL: "http://agentsmith-api:20000/api/v1"
  AGENT_EXECUTION_WS_BASE_URL: "ws://agentsmith-api:20000"
  MBOS_UNIVERSAL_PROXY_BASE_URL: "{{LLMUP_INTERNAL_BASE_URL}}"
  LLMUP_INTERNAL_BASE_URL: "{{LLMUP_INTERNAL_BASE_URL}}"
  SANDBOX_MANAGER_URL: "http://agentsmith-sandbox-manager:8080"
  AFSCP_BASE_URL: "{{AFSCP_BASE_URL}}"
  AFSCP_CALLER_SERVICE: "agentsmith-api"
  AFSCP_BOOTSTRAP_CALLER_SERVICE: "agentsmith-bootstrap"
  AFSCP_DEFAULT_VOLUME_ID: "{{AFSCP_DEFAULT_VOLUME_ID}}"
  KEYCLOAK_ISSUER_URL: "{{SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER}}"
  PUBLIC_KEYCLOAK_BASE_URL: "{{SUBSTRATE_KEYCLOAK_PUBLIC_BASE_URL}}"
  INTERNAL_KEYCLOAK_BASE_URL: "{{SUBSTRATE_KEYCLOAK_INTERNAL_SERVICE_BASE_URL}}"
  KEYCLOAK_BASE_URL: "{{SUBSTRATE_KEYCLOAK_PUBLIC_BASE_URL}}"
  KEYCLOAK_URL: "{{SUBSTRATE_KEYCLOAK_PUBLIC_REALMS_BASE_URL}}"
  KEYCLOAK_REALM: "{{SUBSTRATE_KEYCLOAK_REALM}}"
  KEYCLOAK_CLIENT_ID: "{{SUBSTRATE_KEYCLOAK_CLIENT_ID}}"
  KEYCLOAK_ADMIN_CLIENT_ID: "admin-cli"
  NEXT_PUBLIC_KEYCLOAK_URL: "{{SUBSTRATE_KEYCLOAK_PUBLIC_BASE_URL}}"
  NEXT_PUBLIC_KEYCLOAK_REALM: "{{SUBSTRATE_KEYCLOAK_REALM}}"
  NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: "{{SUBSTRATE_KEYCLOAK_CLIENT_ID}}"
  MINIO_ENDPOINT: "substrate-minio"
  MINIO_PORT: "{{SUBSTRATE_MINIO_SERVICE_PORT}}"
  MINIO_USE_SSL: "false"
  MINIO_BUCKET: "{{SUBSTRATE_MINIO_BUCKET}}"
---
apiVersion: v1
kind: Secret
metadata:
  name: agentsmith-app-secrets
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
type: Opaque
stringData:
  DATABASE_URL: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}"
  MONGO_URL: "mongodb://{{SUBSTRATE_MONGODB_USER}}:{{SUBSTRATE_MONGODB_PASSWORD}}@substrate-mongodb:{{SUBSTRATE_MONGODB_SERVICE_PORT}}/admin"
  MONGO_DB_NAME: "{{SUBSTRATE_MONGODB_DATABASE}}"
  REDIS_URL: "redis://:{{SUBSTRATE_REDIS_PASSWORD}}@substrate-redis:{{SUBSTRATE_REDIS_SERVICE_PORT}}/0"
  MINIO_ACCESS_KEY: "{{SUBSTRATE_MINIO_ACCESS_KEY}}"
  MINIO_SECRET_KEY: "{{SUBSTRATE_MINIO_SECRET_KEY}}"
  AFSCP_SERVICE_TOKEN: "{{AFSCP_SERVICE_TOKEN}}"
  AFSCP_BOOTSTRAP_SERVICE_TOKEN: "{{AFSCP_BOOTSTRAP_SERVICE_TOKEN}}"
  AFSCP_ORCHESTRATOR_SERVICE_TOKEN: "{{AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"
  KEYCLOAK_ADMIN: "{{SUBSTRATE_KEYCLOAK_ADMIN}}"
  KEYCLOAK_ADMIN_PASSWORD: "{{SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD}}"
  SANDBOX_SERVICE_KEY: "{{SANDBOX_SERVICE_KEY}}"
  MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: "{{MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN}}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: agentsmith-llmup-config
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: llmup
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  config.yaml: |
    listen: 0.0.0.0:8080
    upstream_timeout_secs: 120
    data_auth:
      mode: client_provider_key
    upstreams: {}
    model_aliases: {}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandbox-manager-config
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  manager-config.yaml: |
    version: 1
    server:
      httpPort: 8080
      requestIdHeader: X-Request-Id
      timeouts:
        readHeader: 5s
        read: 30s
        write: 60s
        idle: 120s
      maxHeaderBytes: 1048576
      metrics:
        enabled: true
        path: /metrics
      debug:
        configPath: /debug/config
        enablePprof: false
    auth:
      headerName: X-Service-Key
    kubernetes:
      qps: 50
      burst: 100
      requestTimeout: 15s
    sandbox:
      defaults:
        namespace: {{NAMESPACE}}
    afscp:
      baseUrl: "{{AFSCP_BASE_URL}}"
      callerService: agentsmith-sandbox-manager
      actor:
        type: system
        id: agentsmith-sandbox-manager
      tokenEnv: AFSCP_ORCHESTRATOR_SERVICE_TOKEN
    rateLimit:
      requestsPerMinute: 60
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: agentsmith-managed-runner-support
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: managed-runner-support
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  DEFAULT_MANAGED_RUNNER_IMAGE: "{{MANAGED_RUNNER_IMAGE}}"
  DEFAULT_MANAGED_RUNNER_SERVICE_ACCOUNT: agentsmith-managed-runner
  RUNNER_PUBLIC_API_BASE_URL: "{{RUNNER_PUBLIC_API_BASE_URL}}"

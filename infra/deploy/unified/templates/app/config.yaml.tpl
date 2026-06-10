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
  ASBCP_INTERNAL_BASE_URL: "http://agentsmith-sandbox-control-plane:8080"
  AFSCP_BASE_URL: "{{AFSCP_BASE_URL}}"
  AFSCP_CALLER_SERVICE: "agentsmith-api"
  AFSCP_BOOTSTRAP_CALLER_SERVICE: "agentsmith-bootstrap"
  AFSCP_ORCHESTRATOR_CALLER_SERVICE: "agentsmith-sandbox-control-plane"
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
  name: asbcp-config
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: asbcp
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  config.yaml: |
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

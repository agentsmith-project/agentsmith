apiVersion: v1
kind: Service
metadata:
  name: substrate-postgresql
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: postgresql
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ports:
    - name: postgresql
      port: {{SUBSTRATE_POSTGRES_SERVICE_PORT}}
      targetPort: {{SUBSTRATE_POSTGRES_SERVICE_PORT}}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: substrate-postgresql
  namespace: {{NAMESPACE}}
  labels:
    kubernetes.io/service-name: substrate-postgresql
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: postgresql
  annotations:
    rendered-by: agentsmith-unified-deploy
addressType: {{SUBSTRATE_POSTGRES_ADDRESS_TYPE}}
ports:
  - name: postgresql
    protocol: TCP
    port: {{SUBSTRATE_POSTGRES_PORT}}
endpoints:
  - addresses:
      - "{{SUBSTRATE_POSTGRES_HOST}}"
---
apiVersion: v1
kind: Service
metadata:
  name: substrate-mongodb
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: mongodb
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ports:
    - name: mongodb
      port: {{SUBSTRATE_MONGODB_SERVICE_PORT}}
      targetPort: {{SUBSTRATE_MONGODB_SERVICE_PORT}}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: substrate-mongodb
  namespace: {{NAMESPACE}}
  labels:
    kubernetes.io/service-name: substrate-mongodb
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: mongodb
  annotations:
    rendered-by: agentsmith-unified-deploy
addressType: {{SUBSTRATE_MONGODB_ADDRESS_TYPE}}
ports:
  - name: mongodb
    protocol: TCP
    port: {{SUBSTRATE_MONGODB_PORT}}
endpoints:
  - addresses:
      - "{{SUBSTRATE_MONGODB_HOST}}"
---
apiVersion: v1
kind: Service
metadata:
  name: substrate-redis
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: redis
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ports:
    - name: redis
      port: {{SUBSTRATE_REDIS_SERVICE_PORT}}
      targetPort: {{SUBSTRATE_REDIS_SERVICE_PORT}}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: substrate-redis
  namespace: {{NAMESPACE}}
  labels:
    kubernetes.io/service-name: substrate-redis
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: redis
  annotations:
    rendered-by: agentsmith-unified-deploy
addressType: {{SUBSTRATE_REDIS_ADDRESS_TYPE}}
ports:
  - name: redis
    protocol: TCP
    port: {{SUBSTRATE_REDIS_PORT}}
endpoints:
  - addresses:
      - "{{SUBSTRATE_REDIS_HOST}}"
---
apiVersion: v1
kind: Service
metadata:
  name: substrate-minio
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: minio
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ports:
    - name: minio
      port: {{SUBSTRATE_MINIO_SERVICE_PORT}}
      targetPort: {{SUBSTRATE_MINIO_SERVICE_PORT}}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: substrate-minio
  namespace: {{NAMESPACE}}
  labels:
    kubernetes.io/service-name: substrate-minio
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: minio
  annotations:
    rendered-by: agentsmith-unified-deploy
addressType: {{SUBSTRATE_MINIO_ADDRESS_TYPE}}
ports:
  - name: minio
    protocol: TCP
    port: {{SUBSTRATE_MINIO_PORT}}
endpoints:
  - addresses:
      - "{{SUBSTRATE_MINIO_HOST}}"
---
apiVersion: v1
kind: Service
metadata:
  name: substrate-keycloak
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: keycloak
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ports:
    - name: keycloak
      port: {{SUBSTRATE_KEYCLOAK_SERVICE_PORT}}
      targetPort: {{SUBSTRATE_KEYCLOAK_SERVICE_PORT}}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: substrate-keycloak
  namespace: {{NAMESPACE}}
  labels:
    kubernetes.io/service-name: substrate-keycloak
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: substrate-binding
    agentsmith.mbos.dev/substrate-service: keycloak
  annotations:
    rendered-by: agentsmith-unified-deploy
addressType: {{SUBSTRATE_KEYCLOAK_ADDRESS_TYPE}}
ports:
  - name: keycloak
    protocol: TCP
    port: {{SUBSTRATE_KEYCLOAK_PORT}}
endpoints:
  - addresses:
      - "{{SUBSTRATE_KEYCLOAK_HOST}}"

apiVersion: batch/v1
kind: Job
metadata:
  name: agentsmith-product-schema-bootstrap
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: product-schema-bootstrap
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: product-schema-bootstrap
      annotations:
        agentsmith.mbos.dev/checksum-app-config: "{{AGENTSMITH_APP_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      restartPolicy: Never
      serviceAccountName: agentsmith-app
      containers:
        - name: agentsmith-product-schema-bootstrap
          image: "{{API_IMAGE}}"
          command:
            - node
          args:
            - packages/api-entry-node/dist/product-schema-bootstrap.js
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: DATABASE_URL
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-web
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: web
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: web
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: web
      annotations:
        agentsmith.mbos.dev/checksum-app-config: "{{AGENTSMITH_APP_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: agentsmith-app
      containers:
        - name: web
          image: "{{WEB_IMAGE}}"
          command:
            - npm
          args:
            - run
            - start
            - --
            - --hostname
            - 0.0.0.0
            - --port
            - "3001"
          ports:
            - name: http
              containerPort: 3001
          env:
            - name: NEXT_PUBLIC_API_BASE
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: NEXT_PUBLIC_API_BASE
            - name: NEXT_PUBLIC_KEYCLOAK_URL
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: NEXT_PUBLIC_KEYCLOAK_URL
            - name: NEXT_PUBLIC_KEYCLOAK_REALM
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: NEXT_PUBLIC_KEYCLOAK_REALM
            - name: NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
            - name: PUBLIC_KEYCLOAK_BASE_URL
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: PUBLIC_KEYCLOAK_BASE_URL
            - name: INTERNAL_KEYCLOAK_BASE_URL
              valueFrom:
                configMapKeyRef:
                  name: agentsmith-app-config
                  key: INTERNAL_KEYCLOAK_BASE_URL
            - name: MONGO_URL
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: MONGO_URL
            - name: MONGO_DB_NAME
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: MONGO_DB_NAME
---
apiVersion: v1
kind: Service
metadata:
  name: agentsmith-web
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: web
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: web
  ports:
    - name: http
      port: 3001
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: api
      annotations:
        agentsmith.mbos.dev/checksum-app-config: "{{AGENTSMITH_APP_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: agentsmith-app
      containers:
        - name: api
          image: "{{API_IMAGE}}"
          command:
            - npm
          args:
            - run
            - api:node:start
          ports:
            - name: http
              containerPort: 20000
          env:
            - name: PORT
              value: "20000"
            - name: INTERNAL_AGENT_IMAGE
              value: "{{MANAGED_RUNNER_IMAGE}}"
          envFrom:
            - configMapRef:
                name: agentsmith-app-config
            - secretRef:
                name: {{AGENTSMITH_APP_REF}}
---
apiVersion: v1
kind: Service
metadata:
  name: agentsmith-api
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: api
  ports:
    - name: http
      port: 20000
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-llmup
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: llmup
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: llmup
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: llmup
      annotations:
        agentsmith.mbos.dev/checksum-llmup-config: "{{AGENTSMITH_LLMUP_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: agentsmith-app
      containers:
        - name: llmup
          image: "{{LLMUP_IMAGE}}"
          args:
            - --config
            - /app/config/config.yaml
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: LLM_UNIVERSAL_PROXY_AUTH_MODE
              value: client_provider_key
            - name: LLM_UNIVERSAL_PROXY_ADMIN_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 12
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 6
          volumeMounts:
            - name: llmup-config
              mountPath: /app/config/config.yaml
              subPath: config.yaml
              readOnly: true
      volumes:
        - name: llmup-config
          configMap:
            name: agentsmith-llmup-config
---
apiVersion: v1
kind: Service
metadata:
  name: agentsmith-llmup
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: llmup
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: llmup
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-sandbox-control-plane
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: asbcp
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: asbcp
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: asbcp
      annotations:
        agentsmith.mbos.dev/checksum-asbcp-config: "{{ASBCP_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: agentsmith-sandbox-control-plane
      containers:
        - name: asbcp
          image: "{{ASBCP_IMAGE}}"
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: ASBCP_CONFIG_PATH
              value: /etc/asbcp/asbcp-config.yaml
            - name: ASBCP_SERVICE_KEYS
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: ASBCP_SERVICE_KEY
            - name: ASBCP_WORKLOAD_NAMESPACE
              value: "{{NAMESPACE}}"
            - name: ASBCP_AFSCP_INTERNAL_BASE_URL
              value: "{{AFSCP_BASE_URL}}"
            - name: ASBCP_AFSCP_ORCHESTRATOR_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{AGENTSMITH_APP_REF}}
                  key: AFSCP_ORCHESTRATOR_SERVICE_TOKEN
            - name: ASBCP_AFSCP_CALLER_SERVICE
              value: agentsmith-sandbox-control-plane
            - name: ASBCP_AFSCP_ACTOR_TYPE
              value: system
            - name: ASBCP_AFSCP_ACTOR_ID
              value: agentsmith-sandbox-control-plane
          volumeMounts:
            - name: config
              mountPath: /etc/asbcp/asbcp-config.yaml
              subPath: config.yaml
      volumes:
        - name: config
          configMap:
            name: asbcp-config
---
apiVersion: v1
kind: Service
metadata:
  name: agentsmith-sandbox-control-plane
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: asbcp
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: asbcp
  ports:
    - name: http
      port: 8080
      targetPort: http

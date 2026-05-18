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
          envFrom:
            - configMapRef:
                name: agentsmith-app-config
            - secretRef:
                name: agentsmith-app-secrets
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
          envFrom:
            - configMapRef:
                name: agentsmith-app-config
            - secretRef:
                name: agentsmith-app-secrets
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
                name: agentsmith-app-secrets
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
                  name: agentsmith-app-secrets
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
  name: agentsmith-sandbox-manager
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: sandbox-manager
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: sandbox-manager
      annotations:
        agentsmith.mbos.dev/checksum-sandbox-manager-config: "{{SANDBOX_MANAGER_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-app-secrets: "{{AGENTSMITH_APP_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: agentsmith-sandbox-manager
      containers:
        - name: sandbox-manager
          image: "{{SANDBOX_MANAGER_IMAGE}}"
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: CONFIG_PATH
              value: /etc/sandbox-manager/manager-config.yaml
            - name: SERVICE_KEYS
              valueFrom:
                secretKeyRef:
                  name: agentsmith-app-secrets
                  key: SANDBOX_SERVICE_KEY
            - name: K8S_NAMESPACE
              value: "{{NAMESPACE}}"
            - name: JUICEFS_STORAGE_ENDPOINT
              value: "{{AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT}}"
            - name: JUICEFS_STORAGE_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: agentsmith-app-secrets
                  key: MINIO_ACCESS_KEY
            - name: JUICEFS_STORAGE_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: agentsmith-app-secrets
                  key: MINIO_SECRET_KEY
            - name: AFSCP_INTERNAL_BASE_URL
              value: "{{AFSCP_BASE_URL}}"
            - name: AFSCP_ORCHESTRATOR_TOKEN
              valueFrom:
                secretKeyRef:
                  name: agentsmith-app-secrets
                  key: AFSCP_ORCHESTRATOR_SERVICE_TOKEN
            - name: AFSCP_CALLER_SERVICE
              value: agentsmith-sandbox-manager
            - name: AFSCP_ACTOR_TYPE
              value: system
            - name: AFSCP_ACTOR_ID
              value: agentsmith-sandbox-manager
          volumeMounts:
            - name: config
              mountPath: /etc/sandbox-manager/manager-config.yaml
              subPath: manager-config.yaml
      volumes:
        - name: config
          configMap:
            name: sandbox-manager-config
---
apiVersion: v1
kind: Service
metadata:
  name: agentsmith-sandbox-manager
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
  ports:
    - name: http
      port: 8080
      targetPort: http

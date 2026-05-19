apiVersion: v1
kind: ServiceAccount
metadata:
  name: afscp-runtime
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: afscp-runtime-config
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
data:
  AFSCP_ENVIRONMENT: "{{PROFILE}}"
  AFSCP_SERVICE_NAME: "agentsmith-afscp"
  AFSCP_LISTEN_ADDR: "0.0.0.0:8080"
  AFSCP_READINESS_PROFILE: "runtime"
  AFSCP_API_MODE: "internal"
  AFSCP_API_DEPLOYMENT_GLOBAL_ALLOWED_CALLERS: "agentsmith-api:product:operation_inspector,agentsmith-bootstrap:admin:volume_admin|operation_inspector|operator_admin"
  AFSCP_API_DEPLOYMENT_NAMESPACE_ALLOWED_CALLERS: "agentsmith-bootstrap:admin:namespace_admin,agentsmith-api:product:namespace_admin|repo_admin|repo_lifecycle_admin|restore_admin|template_admin|export_admin|mount_admin|operation_inspector,agentsmith-sandbox-control-plane:orchestrator:orchestrator_mount"
  AFSCP_API_VOLUME_ROOTS: "{{AFSCP_DEFAULT_VOLUME_ID}}={{AFSCP_VOLUME_ROOT_PATH}}"
  AFSCP_VOLUME_ROOTS: "{{AFSCP_DEFAULT_VOLUME_ID}}={{AFSCP_VOLUME_ROOT_PATH}}"
  AFSCP_DEFAULT_VOLUME_ID: "{{AFSCP_DEFAULT_VOLUME_ID}}"
  AFSCP_DEFAULT_VOLUME_BACKEND: "{{AFSCP_DEFAULT_VOLUME_BACKEND}}"
  AFSCP_DEFAULT_VOLUME_ISOLATION_CLASS: "{{AFSCP_DEFAULT_VOLUME_ISOLATION_CLASS}}"
  AFSCP_DEFAULT_VOLUME_STATUS: "{{AFSCP_DEFAULT_VOLUME_STATUS}}"
  AFSCP_DEFAULT_VOLUME_ROOT_PATH: "{{AFSCP_VOLUME_ROOT_PATH}}"
  AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON: '{{AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON}}'
  AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS: "{{AFSCP_DEFAULT_VOLUME_ID}}={{NAMESPACE}}/afscp-default-volume-juicefs"
  AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL: "{{AFSCP_EXPORT_GATEWAY_INTERNAL_BASE_URL}}"
  AFSCP_EXPORT_GATEWAY_LISTEN_ADDR: "0.0.0.0:8080"
  AFSCP_EXPORT_GATEWAY_PREFIX: "/e/"
  AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS: "{{AFSCP_DEFAULT_VOLUME_ID}}={{AFSCP_VOLUME_ROOT_PATH}}"
  AFSCP_STORAGE_ENABLED: "true"
  AFSCP_STORAGE_READY: "true"
  AFSCP_JVS_ENABLED: "true"
  AFSCP_JVS_READY: "true"
  AFSCP_JVS_CWD: "{{AFSCP_JVS_CWD_PATH}}"
  AFSCP_WEBDAV_ENABLED: "true"
  AFSCP_WEBDAV_READY: "true"
  AFSCP_MOUNT_ENABLED: "true"
  AFSCP_MOUNT_READY: "true"
  AFSCP_REPO_TEMPLATE_ENABLED: "true"
  AFSCP_REPO_TEMPLATE_READY: "true"
  AFSCP_REPO_PURGE_ENABLED: "false"
  AFSCP_REPO_PURGE_READY: "false"
  AFSCP_WORKER_OPERATION_RECOVERY_ENABLED: "true"
  AFSCP_WORKER_OWNER: "agentsmith-afscp-worker"
  AFSCP_OPERATION_RECOVERY_LIMIT: "10"
  AFSCP_WORKER_RUN_ONCE_TIMEOUT: "30s"
  AFSCP_REPO_CREATE_RECOVERY_ENABLED: "true"
  AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED: "true"
  AFSCP_REPO_PURGE_RECOVERY_ENABLED: "false"
  AFSCP_SAVE_POINT_RECOVERY_ENABLED: "true"
  AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED: "true"
  AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED: "true"
  AFSCP_RESTORE_RECOVERY_ENABLED: "true"
  AFSCP_EXPORT_SESSION_RECONCILE_ENABLED: "true"
  AFSCP_EXPORT_SESSION_RECONCILE_OWNER: "agentsmith-afscp-worker"
  AFSCP_EXPORT_SESSION_RECONCILE_LIMIT: "10"
  AFSCP_WORKLOAD_MOUNT_STALE_LEASE_RECONCILE_ENABLED: "true"
  AFSCP_WORKLOAD_MOUNT_STALE_LEASE_RECONCILE_LIMIT: "50"
---
apiVersion: v1
kind: Secret
metadata:
  name: afscp-runtime-secrets
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
type: Opaque
stringData:
  AFSCP_DATABASE_URL: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  AFSCP_POSTGRES_DSN: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  AFSCP_API_POSTGRES_DSN: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  AFSCP_EXPORT_GATEWAY_POSTGRES_DSN: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN: "postgresql://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@substrate-postgresql:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  AFSCP_API_SERVICE_TOKENS: "agentsmith-api={{AFSCP_SERVICE_TOKEN}},agentsmith-bootstrap={{AFSCP_BOOTSTRAP_SERVICE_TOKEN}},agentsmith-sandbox-control-plane={{AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"
---
apiVersion: v1
kind: Secret
metadata:
  name: afscp-default-volume-juicefs
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
type: Opaque
stringData:
  name: "{{AFSCP_DEFAULT_VOLUME_JUICEFS_NAME}}"
  metaurl: "postgres://{{SUBSTRATE_POSTGRES_USER}}:{{SUBSTRATE_POSTGRES_PASSWORD}}@{{SUBSTRATE_POSTGRES_SERVICE_FQDN}}:{{SUBSTRATE_POSTGRES_SERVICE_PORT}}/{{SUBSTRATE_POSTGRES_DATABASE}}?sslmode=disable"
  storage: "minio"
  bucket: "http://substrate-minio.{{NAMESPACE}}.svc.cluster.local:{{SUBSTRATE_MINIO_SERVICE_PORT}}/{{SUBSTRATE_MINIO_BUCKET}}"
  access-key: "{{SUBSTRATE_MINIO_ACCESS_KEY}}"
  secret-key: "{{SUBSTRATE_MINIO_SECRET_KEY}}"
---
apiVersion: batch/v1
kind: Job
metadata:
  name: afscp-schema-bootstrap
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-schema-bootstrap
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
        app.kubernetes.io/component: afscp-schema-bootstrap
      annotations:
        agentsmith.mbos.dev/checksum-afscp-config: "{{AFSCP_RUNTIME_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-afscp-secrets: "{{AFSCP_RUNTIME_SECRETS_CHECKSUM}}"
    spec:
      restartPolicy: Never
      serviceAccountName: afscp-runtime
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
      containers:
        - name: afscp-schema-bootstrap
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-migrate
          args:
            - --apply
            - --check
            - --timeout=60s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {{AFSCP_DEFAULT_VOLUME_PV_NAME}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  capacity:
    storage: {{AFSCP_DEFAULT_VOLUME_STORAGE_QUANTITY}}
  volumeMode: Filesystem
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: ""
  mountOptions:
    - subdir=/afscp/{{AFSCP_DEFAULT_VOLUME_ID}}
  csi:
    driver: csi.juicefs.com
    volumeHandle: {{AFSCP_DEFAULT_VOLUME_PV_NAME}}
    fsType: juicefs
    nodePublishSecretRef:
      name: afscp-default-volume-juicefs
      namespace: {{NAMESPACE}}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: afscp-default-volume
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-runtime
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  accessModes:
    - ReadWriteMany
  volumeMode: Filesystem
  storageClassName: ""
  volumeName: {{AFSCP_DEFAULT_VOLUME_PV_NAME}}
  resources:
    requests:
      storage: {{AFSCP_DEFAULT_VOLUME_STORAGE_QUANTITY}}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: afscp-volume-bootstrap
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-volume-bootstrap
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
        app.kubernetes.io/component: afscp-volume-bootstrap
      annotations:
        agentsmith.mbos.dev/checksum-afscp-config: "{{AFSCP_RUNTIME_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-afscp-secrets: "{{AFSCP_RUNTIME_SECRETS_CHECKSUM}}"
    spec:
      restartPolicy: Never
      serviceAccountName: afscp-runtime
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
      containers:
        - name: afscp-volume-bootstrap
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-volume-bootstrap
          args:
            - --ensure
            - --check
            - --timeout=60s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: afscp-api
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-api
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: afscp-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: afscp-api
      annotations:
        agentsmith.mbos.dev/checksum-afscp-config: "{{AFSCP_RUNTIME_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-afscp-secrets: "{{AFSCP_RUNTIME_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: afscp-runtime
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
      initContainers:
        - name: afscp-schema-check
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-migrate
          args:
            - --check
            - --timeout=60s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
      containers:
        - name: afscp-api
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-api
          args:
            - --serve
            - --listen
            - 0.0.0.0:8080
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 12
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 6
          volumeMounts:
            - name: afscp-default-volume
              mountPath: "{{AFSCP_VOLUME_ROOT_PATH}}"
            - name: afscp-jvs-cwd
              mountPath: "{{AFSCP_JVS_CWD_PATH}}"
      volumes:
        - name: afscp-default-volume
          persistentVolumeClaim:
            claimName: afscp-default-volume
        - name: afscp-jvs-cwd
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: afscp-api
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-api
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-api
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: afscp-worker
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-worker
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: afscp-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: afscp-worker
      annotations:
        agentsmith.mbos.dev/checksum-afscp-config: "{{AFSCP_RUNTIME_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-afscp-secrets: "{{AFSCP_RUNTIME_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: afscp-runtime
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
      initContainers:
        - name: afscp-schema-check
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-migrate
          args:
            - --check
            - --timeout=60s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
      containers:
        - name: afscp-worker
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-worker
          args:
            - --loop
            - --interval=2s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
          volumeMounts:
            - name: afscp-default-volume
              mountPath: "{{AFSCP_VOLUME_ROOT_PATH}}"
            - name: afscp-jvs-cwd
              mountPath: "{{AFSCP_JVS_CWD_PATH}}"
      volumes:
        - name: afscp-default-volume
          persistentVolumeClaim:
            claimName: afscp-default-volume
        - name: afscp-jvs-cwd
          emptyDir: {}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: afscp-export-gateway
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-export-gateway
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentsmith
      app.kubernetes.io/component: afscp-export-gateway
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentsmith
        app.kubernetes.io/component: afscp-export-gateway
      annotations:
        agentsmith.mbos.dev/checksum-afscp-config: "{{AFSCP_RUNTIME_CONFIG_CHECKSUM}}"
        agentsmith.mbos.dev/checksum-afscp-secrets: "{{AFSCP_RUNTIME_SECRETS_CHECKSUM}}"
    spec:
      serviceAccountName: afscp-runtime
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
      initContainers:
        - name: afscp-schema-check
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-migrate
          args:
            - --check
            - --timeout=60s
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
      containers:
        - name: afscp-export-gateway
          image: "{{AFSCP_IMAGE}}"
          command:
            - /usr/local/bin/afscp-export-gateway
          args:
            - --serve
            - --listen-addr
            - 0.0.0.0:8080
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: afscp-runtime-config
            - secretRef:
                name: afscp-runtime-secrets
          readinessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 12
          livenessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 6
          volumeMounts:
            - name: afscp-default-volume
              mountPath: "{{AFSCP_VOLUME_ROOT_PATH}}"
            - name: afscp-jvs-cwd
              mountPath: "{{AFSCP_JVS_CWD_PATH}}"
      volumes:
        - name: afscp-default-volume
          persistentVolumeClaim:
            claimName: afscp-default-volume
        - name: afscp-jvs-cwd
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: afscp-export-gateway
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-export-gateway
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  selector:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: afscp-export-gateway
  ports:
    - name: http
      port: 8080
      targetPort: http

apiVersion: v1
kind: ServiceAccount
metadata:
  name: agentsmith-app
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agentsmith-sandbox-manager
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: agentsmith-sandbox-manager
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/status", "pods/exec", "persistentvolumeclaims", "secrets", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agentsmith-sandbox-manager
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
subjects:
  - kind: ServiceAccount
    name: agentsmith-sandbox-manager
    namespace: {{NAMESPACE}}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: agentsmith-sandbox-manager
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agentsmith-managed-runner
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: managed-runner-support
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: agentsmith-managed-runner-support
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: managed-runner-support
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agentsmith-managed-runner-support
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: managed-runner-support
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
subjects:
  - kind: ServiceAccount
    name: agentsmith-managed-runner
    namespace: {{NAMESPACE}}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: agentsmith-managed-runner-support

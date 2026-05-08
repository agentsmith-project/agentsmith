apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: agentsmith-sandbox-manager-pv
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
    agentsmith.mbos.dev/profile: {{PROFILE}}
  annotations:
    rendered-by: agentsmith-unified-deploy
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: agentsmith-sandbox-manager-pv
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/component: sandbox-manager
    app.kubernetes.io/part-of: agentsmith-deploy
    agentsmith.mbos.dev/profile: {{PROFILE}}
  annotations:
    rendered-by: agentsmith-unified-deploy
subjects:
  - kind: ServiceAccount
    name: agentsmith-sandbox-manager
    namespace: {{NAMESPACE}}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: agentsmith-sandbox-manager-pv

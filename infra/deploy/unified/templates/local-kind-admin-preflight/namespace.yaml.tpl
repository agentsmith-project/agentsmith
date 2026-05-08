apiVersion: v1
kind: Namespace
metadata:
  name: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/part-of: agentsmith-deploy
    agentsmith.mbos.dev/profile: {{PROFILE}}
  annotations:
    rendered-by: agentsmith-unified-deploy

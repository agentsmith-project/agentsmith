apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agentsmith
  namespace: {{NAMESPACE}}
  labels:
    app.kubernetes.io/name: agentsmith
    app.kubernetes.io/part-of: agentsmith-deploy
  annotations:
    rendered-by: agentsmith-unified-deploy
spec:
  ingressClassName: "{{INGRESS_CLASS_NAME}}"
  rules:
    - host: "{{INGRESS_HOST}}"
      http:
        paths:
          - path: /api/public
            pathType: Prefix
            backend:
              service:
                name: agentsmith-web
                port:
                  number: 3001
          - path: /api/system
            pathType: Prefix
            backend:
              service:
                name: agentsmith-web
                port:
                  number: 3001
          - path: /api/v1
            pathType: Prefix
            backend:
              service:
                name: agentsmith-api
                port:
                  number: 20000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: agentsmith-web
                port:
                  number: 3001

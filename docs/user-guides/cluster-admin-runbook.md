# Cluster Admin Runbook

Status: historical current-v1 reference only.

The old cluster-admin handoff belonged to the retired `cluster-deploy` runbook. The current deploy model treats `existing-cluster` as a unified deploy profile and consumes operator-provided Kubernetes access plus declared substrate truth.

Do not use this file as a current administrator checklist. Current deploy operators should use:

- [Unified Deploy Operations](./unified-deploy-operations.md)
- `npm run test:unified-deploy:existing-cluster-smoke`
- `infra/deploy/unified/substrate/connection.env` or another declared substrate truth file
- a profile-specific site env for the target cluster

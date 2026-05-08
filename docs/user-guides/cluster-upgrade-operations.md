# Cluster Upgrade Operations

Status: historical current-v1 reference only.

The old `cluster upgrade` line belonged to the retired `cluster-deploy` runbook. The current deployment model has one AgentSmith deploy path with `local-kind` and `existing-cluster` profiles.

Do not use this file as a current upgrade runbook. Until a new unified upgrade runbook is introduced, validate deployment changes through:

- [Unified Deploy Operations](./unified-deploy-operations.md)
- `npm run test:unified-deploy:local-kind:images`
- `npm run test:unified-deploy:local-kind`
- `npm run test:unified-deploy:existing-cluster-smoke`
- focused product flows for `workspace_project`, `files`, and `agent_task_managed_runner`

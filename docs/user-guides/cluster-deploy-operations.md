# Cluster Deploy Operations

Status: historical current-v1 reference only.

The current deployment path is [Unified Deploy Operations](./unified-deploy-operations.md). There is no separate cluster deploy product path in the current model; `existing-cluster` is a unified deploy profile.

Keep this file only for readers who are investigating old `cluster-deploy` scripts or v1 deployment contracts. Do not use it as a current runbook, release checklist, or verification entrypoint.

Current replacements:

- Existing-cluster deploy smoke: `npm run test:unified-deploy:existing-cluster-smoke`
- Local Kubernetes deploy proof: `npm run test:unified-deploy:local-kind:images` then `npm run test:unified-deploy:local-kind`
- Minimal product proof after deploy: focused `npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner`
- Current guide: [Unified Deploy Operations](./unified-deploy-operations.md)

# Demo Deploy Operations

Status: historical current-v1 reference only.

The current deployment path is [Unified Deploy Operations](./unified-deploy-operations.md). There is no separate demo deploy product path in the current model.

Keep this file only for readers who are investigating old `demo-deploy` scripts or v1 deployment contracts. Do not use it as a current runbook, release checklist, or verification entrypoint.

Current replacements:

- Local Kubernetes deploy proof: `npm run test:unified-deploy:local-kind:images` then `npm run test:unified-deploy:local-kind`
- Existing-cluster deploy smoke: `npm run test:unified-deploy:existing-cluster-smoke`
- Minimal product proof after deploy: focused `npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner`
- Current guide: [Unified Deploy Operations](./unified-deploy-operations.md)

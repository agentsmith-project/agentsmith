# AgentSmith Demo Deploy Bundle

This bundle supports two deployment modes:

- `full`
  - Docker Compose substrate and app
  - local `kind`
  - JuiceFS CSI
  - `sandbox-manager`
  - external and internal agents
- `simple`
  - Docker Compose substrate and app
  - `universal-proxy`
  - `external-runner`
  - external agents only

Set the mode in `env/site.env` before running:

```bash
DEMO_DEPLOY_MODE=full
```

or:

```bash
DEMO_DEPLOY_MODE=simple
```

Standard flow:

```bash
bash scripts/prepare.sh
bash scripts/deploy.sh
bash scripts/bootstrap.sh
bash scripts/verify.sh
bash scripts/report.sh
```

Reset:

```bash
bash scripts/reset.sh
```

Use these documents from the bundle:

- `docs/contracts/deployment-spec-v1.md`
- `docs/user-guides/demo-deploy-operations.md`
- `docs/user-guides/demo-deploy-simple-quickstart-zh.md`

Mode summary:

- `simple` skips `kind`, JuiceFS CSI, `sandbox-manager`, and preset internal agent creation/verification.
- `full` deploys and verifies the complete demo surface.

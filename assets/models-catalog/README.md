# Models Catalog (Offline)

This directory stores offline model metadata snapshots for endpoint configuration UI.

- Source: `https://models.dev/api.json`
- Logos: `https://models.dev/logos/{provider}.svg`
- Sync command: `npm run models:sync-catalog`

Runtime must read only local files from this directory to support air-gapped deployments.

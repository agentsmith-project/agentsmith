# Offline Models Catalog Workflow

## Why

Endpoint configuration must work in low-connectivity and air-gapped deployments.
Runtime should not depend on remote metadata APIs.

## Source of truth

- Model metadata: `https://models.dev/api.json`
- Provider logos: `https://models.dev/logos/{provider}.svg`

## Sync command

```bash
npm run models:sync-catalog
```

## Generated files

- `assets/models-catalog/catalog.normalized.json`
- `assets/models-catalog/logos/*.svg`

## Runtime rule

- Read only local files under `assets/models-catalog`.
- Do not fetch model metadata/logos from remote services at request time.

## Release gate

Run sync before release packaging and commit generated catalog updates with the feature changes that depend on them.

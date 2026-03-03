# Offline Models Catalog Workflow

> Status: transitional.
> Canonical runtime governance is defined in `models-catalog-runtime-governance-contract.md`.
> This document describes legacy/offline packaging behavior and seed asset expectations.

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

## Runtime rule (legacy baseline)

- Read only local files under `assets/models-catalog`.
- Do not fetch model metadata/logos from remote services at request time.

## Bootstrap note

- Offline artifacts can be used as cold-start seed input when runtime catalog DB is empty.
- Seed import must go through runtime validation/normalization pipeline, not direct frontend file reads.

## Release gate (legacy)

Run sync before release packaging and commit generated catalog updates with the feature changes that depend on them.

# OpenAPI Generation

This folder contains generation utilities driven by `docs/contracts/specs/openapi.yaml`.

## Commands

- `npm run openapi:generate`
  - Generates `src/lib/api/types.generated.ts` using `openapi-typescript`.
- `npm run openapi:check-generated`
  - Fails when `src/lib/api/types.generated.ts` is out of sync with the current OpenAPI spec.
- `npm run openapi:changelog`
  - Generates `docs/contracts/specs/CHANGELOG.md` by diffing current OpenAPI against `origin/main`.

## Notes

- `generate-msw-handlers.ts` and `generate-mock-fixtures.ts` are currently placeholders for future contract-driven mock generation.

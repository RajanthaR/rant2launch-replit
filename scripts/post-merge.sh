#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Demo project seed runs automatically on api-server boot (idempotent),
# so no explicit seed step is needed here. Set DEMO_SEED_FORCE=1 in the
# api-server env to refresh the seed from artifacts/api-server/src/seeds/demo.

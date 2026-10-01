DATABASE_URL ?= postgres://postgres@localhost:5432/obesity_trials
export DATABASE_URL

.PHONY: help db-migrate sync sync-full backfill rebuild-products scheduler \
        web-dev web-build test up down

help:
	@echo "Targets:"
	@echo "  db-migrate     apply schema migrations (also converts an older database)"
	@echo "  sync           run an incremental CT.gov sync (updates + new)"
	@echo "  sync-full      full CT.gov backfill (all obesity trials, 2000+)"
	@echo "  backfill       alias for a full backfill"
	@echo "  scheduler      run the daily auto-update scheduler (midnight)"
	@echo "  rebuild-products  re-derive drug products (after editing product_aliases)"
	@echo "  web-dev        run the Next.js dev server"
	@echo "  test           run sync unit/integration tests"
	@echo "  up / down      docker compose up / down"

db-migrate:
	bash db/run-migrations.sh

sync:
	cd sync && npm run sync

sync-full:
	cd sync && npm run sync:full

backfill:
	cd sync && npm run backfill

scheduler:
	cd sync && npm run scheduler

rebuild-products:
	cd sync && npm run rebuild-products

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

test:
	cd sync && npm test

up:
	docker compose up --build

down:
	docker compose down

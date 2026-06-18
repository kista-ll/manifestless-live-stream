.PHONY: bootstrap lint test build e2e run clean phase0-check

PYTHON ?= C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe
NPM ?= C:/Program Files/nodejs/npm.cmd

bootstrap:
	@node scripts/phase0-check.mjs bootstrap

lint:
	@node scripts/phase0-check.mjs lint
	@$(PYTHON) -m ruff check apps/server/src apps/server/tests
	@$(PYTHON) -m mypy --config-file apps/server/pyproject.toml apps/server/src apps/server/tests
	@"$(NPM)" --prefix apps/viewer run lint

test:
	@node scripts/phase0-check.mjs test
	@$(PYTHON) -m pytest apps/server/tests
	@"$(NPM)" --prefix apps/viewer run test
	@node scripts/phase1-smoke.mjs

build:
	@node scripts/phase0-check.mjs build
	@$(PYTHON) -m compileall -q apps/server/src
	@"$(NPM)" --prefix apps/viewer run build
	@node scripts/verify-segments.mjs --skip-when-empty

e2e:
	@"$(NPM)" --prefix apps/viewer run e2e

run:
	@$(PYTHON) -m manifestless_server

clean:
	@node scripts/phase0-check.mjs clean

phase0-check:
	@node scripts/phase0-check.mjs phase0

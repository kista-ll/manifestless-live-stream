.PHONY: help bootstrap cert lint test build e2e run stream-start stream-stop browser-open stop clean phase0-check

PYTHON ?= C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe
NPM ?= C:/Program Files/nodejs/npm.cmd

help:
	@node -e "for (const line of ['help          Show available targets','bootstrap     Install dependencies and prepare local environment','cert          Generate localhost ECDSA P-256 certificate','run           Start WebTransport/API server, viewer, and SRT listener','stream-start  Start FFmpeg test encoder as SRT Caller','stream-stop   Stop FFmpeg test encoder','browser-open  Open Chrome/Edge with WebTransport flags and cert hash','stop          Stop project server, viewer, segmenter, and test encoder','clean         Remove generated media, certificates, and test artifacts','lint          Run Ruff, mypy, and ESLint','test          Run pytest, Vitest, and segment smoke test','build         Compile server/viewer and verify generated segments when present','e2e           Run Playwright acceptance E2E']) console.log(line)"

bootstrap:
	@node scripts/phase0-check.mjs bootstrap
	@"$(PYTHON)" -m pip install -e "apps/server[dev]"
	@"$(NPM)" --prefix apps/viewer ci
	@"$(PYTHON)" scripts/generate-cert.py

cert:
	@"$(PYTHON)" scripts/generate-cert.py

lint:
	@node scripts/phase0-check.mjs lint
	@"$(PYTHON)" -m ruff check apps/server/src apps/server/tests
	@"$(PYTHON)" -m mypy --config-file apps/server/pyproject.toml apps/server/src apps/server/tests
	@"$(NPM)" --prefix apps/viewer run lint

test:
	@node scripts/phase0-check.mjs test
	@"$(PYTHON)" -m pytest apps/server/tests
	@"$(NPM)" --prefix apps/viewer run test
	@node scripts/phase1-smoke.mjs

build:
	@node scripts/phase0-check.mjs build
	@"$(PYTHON)" -m compileall -q apps/server/src
	@"$(NPM)" --prefix apps/viewer run build
	@node scripts/verify-segments.mjs --skip-when-empty

e2e:
	@"$(NPM)" --prefix apps/viewer run e2e

run:
	@node scripts/dev-run.mjs

stream-start:
	@node scripts/stream-start.mjs

stream-stop:
	@node scripts/stop-processes.mjs stream-caller

browser-open:
	@node scripts/open-viewer-browser.mjs

stop:
	@node scripts/stop-processes.mjs

clean:
	@node scripts/phase0-check.mjs clean

phase0-check:
	@node scripts/phase0-check.mjs phase0

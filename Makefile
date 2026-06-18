SHELL := /bin/sh

.PHONY: bootstrap lint test build e2e run clean phase0-check

bootstrap:
	@node scripts/phase0-check.mjs bootstrap

lint:
	@node scripts/phase0-check.mjs lint

test:
	@node scripts/phase0-check.mjs test

build:
	@node scripts/phase0-check.mjs build

e2e:
	@node scripts/phase0-check.mjs e2e

run:
	@node scripts/phase0-check.mjs run

clean:
	@node scripts/phase0-check.mjs clean

phase0-check:
	@node scripts/phase0-check.mjs phase0

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] ?? "phase0";

const requiredPaths = [
  "AGENTS.md",
  "docs/REQUIREMENTS.md",
  "docs/CODEX_RULES.md",
  "docs/DECISIONS.md",
  "apps/server/pyproject.toml",
  "apps/server/src/manifestless_server/__init__.py",
  "apps/server/tests/test_phase0.py",
  "apps/viewer/package.json",
  "apps/viewer/src/main.ts",
  "apps/viewer/tests/phase0.test.ts",
  "apps/viewer/e2e/phase0.spec.ts",
  "compose.yaml",
  "Makefile",
  ".gitignore",
  ".env.example",
  "media/live/.gitkeep",
  "scripts/generate-cert.sh",
];

function assertPath(path) {
  if (!existsSync(join(root, path))) {
    throw new Error(`Required path is missing: ${path}`);
  }
}

function assertGitIgnore() {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  const requiredPatterns = [
    ".env",
    "certs/",
    "*.key",
    "media/live/*",
    "!media/live/.gitkeep",
    "node_modules/",
    ".venv/",
    "playwright-report/",
    "test-results/",
    "coverage/",
  ];

  for (const pattern of requiredPatterns) {
    if (!gitignore.includes(pattern)) {
      throw new Error(`.gitignore does not include required pattern: ${pattern}`);
    }
  }
}

function assertCompose() {
  const compose = readFileSync(join(root, "compose.yaml"), "utf8");
  if (!compose.includes('"9000:9000/udp"')) {
    throw new Error("compose.yaml must expose SRT as UDP 9000");
  }
}

function assertPackageConfig() {
  const packageJson = JSON.parse(readFileSync(join(root, "apps/viewer/package.json"), "utf8"));
  for (const script of ["lint", "test", "build", "e2e"]) {
    if (typeof packageJson.scripts?.[script] !== "string") {
      throw new Error(`viewer package.json is missing script: ${script}`);
    }
  }
}

function runPhase0Checks() {
  for (const path of requiredPaths) {
    assertPath(path);
  }

  assertGitIgnore();
  assertCompose();
  assertPackageConfig();
}

function cleanGeneratedArtifacts() {
  for (const path of [
    "apps/viewer/dist",
    "coverage",
    "htmlcov",
    "playwright-report",
    "test-results",
    "tmp",
  ]) {
    rmSync(join(root, path), { force: true, recursive: true });
  }
}

if (["bootstrap", "lint", "test", "build", "phase0"].includes(mode)) {
  runPhase0Checks();
  console.log(`${mode}: ok`);
} else if (mode === "clean") {
  cleanGeneratedArtifacts();
  console.log("clean: ok");
} else if (mode === "e2e") {
  throw new Error("E2E is not implemented until Phase 8");
} else if (mode === "run") {
  throw new Error("Runtime server is not implemented until later phases");
} else {
  throw new Error(`Unknown phase0-check mode: ${mode}`);
}

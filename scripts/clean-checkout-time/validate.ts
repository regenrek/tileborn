export const CLEAN_CHECKOUT_SCRIPT_PATH = "scripts/clean-checkout-smoke.sh";

export const CLEAN_CHECKOUT_TIME_LIMITS = {
  installMs: 90_000,
  bootstrapMs: 90_000,
  typecheckMs: 90_000,
  buildMs: 90_000,
  devCdpReadyMs: 30_000,
  totalMs: 300_000,
} as const;

export type CleanCheckoutTimeStepName =
  | "pnpm install --frozen-lockfile"
  | "bootstrap package builds (composite references)"
  | "pnpm turbo run typecheck --filter=!@tileborne/desktop"
  | "pnpm -w build"
  | "pnpm --filter @tileborne/desktop dev:cdp";

export interface CleanCheckoutTimeStep {
  readonly name: CleanCheckoutTimeStepName;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly limitMs: number;
  readonly passed: boolean;
}

export interface CleanCheckoutTimeReport {
  readonly scriptPath: string;
  readonly mode: "time";
  readonly totalMs: number;
  readonly totalLimitMs: number;
  readonly passed: boolean;
  readonly steps: readonly CleanCheckoutTimeStep[];
}

const STEP_LIMITS: Record<CleanCheckoutTimeStepName, number> = {
  "pnpm install --frozen-lockfile": CLEAN_CHECKOUT_TIME_LIMITS.installMs,
  "bootstrap package builds (composite references)": CLEAN_CHECKOUT_TIME_LIMITS.bootstrapMs,
  "pnpm turbo run typecheck --filter=!@tileborne/desktop": CLEAN_CHECKOUT_TIME_LIMITS.typecheckMs,
  "pnpm -w build": CLEAN_CHECKOUT_TIME_LIMITS.buildMs,
  "pnpm --filter @tileborne/desktop dev:cdp": CLEAN_CHECKOUT_TIME_LIMITS.devCdpReadyMs,
};

const REQUIRED_STEPS: readonly CleanCheckoutTimeStepName[] = [
  "pnpm install --frozen-lockfile",
  "bootstrap package builds (composite references)",
  "pnpm turbo run typecheck --filter=!@tileborne/desktop",
  "pnpm -w build",
  "pnpm --filter @tileborne/desktop dev:cdp",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStep(value: unknown, index: number): CleanCheckoutTimeStep {
  if (!isRecord(value)) {
    throw new Error(`steps[${index}] must be an object`);
  }

  const name = value.name;
  if (typeof name !== "string" || !(name in STEP_LIMITS)) {
    throw new Error(`steps[${index}].name is invalid`);
  }

  const exitCode = value.exitCode;
  const durationMs = value.durationMs;
  const limitMs = value.limitMs;
  const passed = value.passed;

  if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) {
    throw new Error(`steps[${index}].exitCode must be a number`);
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`steps[${index}].durationMs must be a non-negative number`);
  }
  if (typeof limitMs !== "number" || !Number.isFinite(limitMs) || limitMs <= 0) {
    throw new Error(`steps[${index}].limitMs must be a positive number`);
  }
  if (typeof passed !== "boolean") {
    throw new Error(`steps[${index}].passed must be a boolean`);
  }

  return {
    name: name as CleanCheckoutTimeStepName,
    exitCode,
    durationMs,
    limitMs,
    passed,
  };
}

export function parseCleanCheckoutTimeReport(value: unknown): CleanCheckoutTimeReport {
  if (!isRecord(value)) {
    throw new Error("report must be an object");
  }

  if (value.scriptPath !== CLEAN_CHECKOUT_SCRIPT_PATH) {
    throw new Error("scriptPath must match clean-checkout-smoke.sh");
  }
  if (value.mode !== "time") {
    throw new Error('mode must be "time"');
  }

  const totalMs = value.totalMs;
  const totalLimitMs = value.totalLimitMs;
  const passed = value.passed;
  const stepsValue = value.steps;

  if (typeof totalMs !== "number" || !Number.isFinite(totalMs) || totalMs < 0) {
    throw new Error("totalMs must be a non-negative number");
  }
  if (typeof totalLimitMs !== "number" || !Number.isFinite(totalLimitMs) || totalLimitMs <= 0) {
    throw new Error("totalLimitMs must be a positive number");
  }
  if (typeof passed !== "boolean") {
    throw new Error("passed must be a boolean");
  }
  if (!Array.isArray(stepsValue)) {
    throw new Error("steps must be an array");
  }

  const steps = stepsValue.map(parseStep);
  return {
    scriptPath: CLEAN_CHECKOUT_SCRIPT_PATH,
    mode: "time",
    totalMs,
    totalLimitMs,
    passed,
    steps,
  };
}

export function assertCleanCheckoutTimeBoundaries(report: CleanCheckoutTimeReport): void {
  if (report.totalLimitMs !== CLEAN_CHECKOUT_TIME_LIMITS.totalMs) {
    throw new Error(`totalLimitMs must be ${CLEAN_CHECKOUT_TIME_LIMITS.totalMs}`);
  }

  const names = report.steps.map((step) => step.name);
  for (const required of REQUIRED_STEPS) {
    if (!names.includes(required)) {
      throw new Error(`missing required step: ${required}`);
    }
  }

  for (const step of report.steps) {
    const expectedLimit = STEP_LIMITS[step.name];
    if (step.limitMs !== expectedLimit) {
      throw new Error(`${step.name} limitMs must be ${expectedLimit}`);
    }
    if (step.exitCode !== 0) {
      throw new Error(`${step.name} must exit 0`);
    }
    if (step.durationMs > step.limitMs) {
      throw new Error(`${step.name} exceeded limit (${step.durationMs}ms > ${step.limitMs}ms)`);
    }
    if (!step.passed) {
      throw new Error(`${step.name} must be marked passed`);
    }
  }

  if (report.totalMs > report.totalLimitMs) {
    throw new Error(`total duration exceeded limit (${report.totalMs}ms > ${report.totalLimitMs}ms)`);
  }

  if (!report.passed) {
    throw new Error("report must be marked passed");
  }
}

export function extractCleanCheckoutTimeJson(output: string): unknown {
  const begin = "CLEAN_CHECKOUT_TIME_JSON_BEGIN";
  const end = "CLEAN_CHECKOUT_TIME_JSON_END";
  const start = output.indexOf(begin);
  const finish = output.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start) {
    throw new Error("clean-checkout-time JSON markers not found");
  }
  const jsonText = output.slice(start + begin.length, finish).trim();
  return JSON.parse(jsonText) as unknown;
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertCleanCheckoutTimeBoundaries,
  CLEAN_CHECKOUT_TIME_LIMITS,
  extractCleanCheckoutTimeJson,
  parseCleanCheckoutTimeReport,
} from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(here, 'fixtures', name), 'utf8')) as unknown;
}

describe('clean-checkout-time report validation', () => {
  it('accepts a passing fixture within all contributor timing limits', () => {
    const report = parseCleanCheckoutTimeReport(loadFixture('pass.json'));
    expect(() => assertCleanCheckoutTimeBoundaries(report)).not.toThrow();
    expect(report.totalMs).toBeLessThanOrEqual(CLEAN_CHECKOUT_TIME_LIMITS.totalMs);
  });

  it('rejects a fixture that exceeds an install timing limit', () => {
    const report = parseCleanCheckoutTimeReport(loadFixture('fail-install-over-limit.json'));
    expect(() => assertCleanCheckoutTimeBoundaries(report)).toThrow(
      /install --frozen-lockfile exceeded limit/,
    );
  });

  it('rejects a fixture that exceeds total wall time', () => {
    const report = parseCleanCheckoutTimeReport(loadFixture('fail-total-over-limit.json'));
    expect(() => assertCleanCheckoutTimeBoundaries(report)).toThrow(
      /total duration exceeded limit/,
    );
  });

  it('extracts JSON markers from script output', () => {
    const fixture = loadFixture('pass.json');
    const wrapped = [
      '==> clean-checkout time smoke',
      'CLEAN_CHECKOUT_TIME_JSON_BEGIN',
      JSON.stringify(fixture, null, 2),
      'CLEAN_CHECKOUT_TIME_JSON_END',
    ].join('\n');

    const parsed = parseCleanCheckoutTimeReport(extractCleanCheckoutTimeJson(wrapped));
    expect(() => assertCleanCheckoutTimeBoundaries(parsed)).not.toThrow();
  });
});

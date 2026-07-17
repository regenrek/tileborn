import { parseArgs } from 'citty';
import { describe, expect, it } from 'vitest';

import { globalArgs } from './commands/shared.js';

describe('global CLI args', () => {
  it('defaults json and verbose to false', () => {
    const parsed = parseArgs([], globalArgs);
    expect(parsed.json).toBe(false);
    expect(parsed.verbose).toBe(false);
  });

  it('parses --json and --verbose flags', () => {
    const parsed = parseArgs(['--json', '-v'], globalArgs);
    expect(parsed.json).toBe(true);
    expect(parsed.verbose).toBe(true);
  });
});

describe('project init args', () => {
  const initArgs = {
    ...globalArgs,
    slug: { type: 'positional' as const, required: true },
    here: { type: 'boolean' as const, default: false },
    template: { type: 'string' as const, required: false },
  };

  it('parses slug positional', () => {
    const parsed = parseArgs(['demo-proj'], initArgs);
    expect(parsed.slug).toBe('demo-proj');
    expect(parsed.here).toBe(false);
  });

  it('parses --here and --template', () => {
    const parsed = parseArgs(['demo-proj', '--here', '--template', 'blank'], initArgs);
    expect(parsed.here).toBe(true);
    expect(parsed.template).toBe('blank');
  });
});

describe('config get args', () => {
  const getArgs = {
    ...globalArgs,
    key: { type: 'positional' as const, required: true },
  };

  it('requires config key positional', () => {
    const parsed = parseArgs(['loggerLevel'], getArgs);
    expect(parsed.key).toBe('loggerLevel');
  });
});

describe('home set args', () => {
  const setArgs = {
    ...globalArgs,
    path: { type: 'positional' as const, required: true },
  };

  it('parses home path positional', () => {
    const parsed = parseArgs(['/tmp/new-home'], setArgs);
    expect(parsed.path).toBe('/tmp/new-home');
  });
});

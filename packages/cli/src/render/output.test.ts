import { describe, expect, it } from 'vitest';

import { ExitCode, exitCodeLabel } from './exit-codes.js';
import { renderFailure } from './output.js';

describe('renderFailure JSON shape', () => {
  it('emits nested error object with symbolic code and numeric exitCode', () => {
    const stderrWrites: string[] = [];
    const stdoutWrite = process.stdout.write.bind(process.stdout);
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const exit = process.exit;

    process.stdout.write = () => true;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit;

    try {
      expect(() =>
        renderFailure({ json: true, verbose: false }, new Error('bad input'), ExitCode.DataErr),
      ).toThrow('exit:65');
    } finally {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
      process.exit = exit;
    }

    const payload = JSON.parse(stderrWrites.join('')) as {
      error: { code: string; exitCode: number; message: string };
    };
    expect(payload.error.code).toBe('DATAERR');
    expect(payload.error.exitCode).toBe(65);
    expect(payload.error.message).toBe('bad input');
    expect(payload).not.toHaveProperty('ok');
  });

  it('maps exit codes to symbolic sysexit names', () => {
    expect(exitCodeLabel(ExitCode.Usage)).toBe('USAGE');
    expect(exitCodeLabel(ExitCode.NoInput)).toBe('NOINPUT');
    expect(exitCodeLabel(ExitCode.IoErr)).toBe('IOERR');
    expect(exitCodeLabel(ExitCode.TempFail)).toBe('TEMPFAIL');
  });
});

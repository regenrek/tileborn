import { describe, expect, it } from 'vitest';

import {
  InvalidGameplayProgramError,
  assertValidGameplayProgram,
  validateGameplayProgram,
} from './index.js';

const validate = (sourceText: string) =>
  validateGameplayProgram({
    projectRoot: '/game',
    files: [{ fileName: '/game/src/behavior.ts', sourceText }],
  });

describe('gameplay source validation', () => {
  it('keeps normal native TypeScript and project-safe composition valid', () => {
    expect(
      validate(`
        import { defineBehavior } from "@tileborne/game-sdk";
        import { clamp } from "./math.js";
        type Counter<T> = { value: T };
        const bump = <T extends number>(counter: Counter<T>) => clamp(counter.value + 1);
        export default defineBehavior({ id: "example.native-ts", state: { count: bump({ value: 1 }) } });
      `),
    ).toEqual([]);
  });

  it('reports stable actionable diagnostics for forbidden imports and APIs', () => {
    const diagnostics = validate(`
      import fs from "node:fs";
      import escaped from "../../../outside.js";
      const wallTime = Date.now();
      const random = Math.random();
      setTimeout(() => fs.readFileSync(escaped), 10);
      const socket = new WebSocket("wss://unsafe.example");
      void import("./dynamic.js");
    `);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'TBSDK1001',
      'TBSDK1001',
      'TBSDK1002',
      'TBSDK1002',
      'TBSDK1002',
      'TBSDK1002',
      'TBSDK1003',
    ]);
    expect(diagnostics.map(({ suggestion }) => suggestion)).toContain(
      'Use context.rng.nextFloat(), integer(), or pick().',
    );
    expect(diagnostics.map(({ suggestion }) => suggestion)).toContain(
      'Use context.timers.after(ticks, timerId).',
    );
  });

  it('supports explicitly approved project dependencies without allowing Node imports', () => {
    expect(
      validateGameplayProgram({
        projectRoot: '/game',
        allowedBareImports: ['@studio/shared-gameplay'],
        files: [
          {
            fileName: '/game/src/behavior.ts',
            sourceText: 'import { helper } from "@studio/shared-gameplay"; helper();',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('validates only reachable files when compilation roots are provided', () => {
    const files = [
      { fileName: '/game/src/good.ts', sourceText: 'import "./shared"; export default {};' },
      { fileName: '/game/src/shared.ts', sourceText: 'export const value = 1;' },
      { fileName: '/game/src/unrelated.ts', sourceText: 'fetch("/unsafe");' },
    ];
    expect(
      validateGameplayProgram({
        projectRoot: '/game',
        files,
        rootFiles: ['/game/src/good.ts'],
      }),
    ).toEqual([]);
    expect(
      validateGameplayProgram({
        projectRoot: '/game',
        files,
        rootFiles: ['/game/src/unrelated.ts'],
      }),
    ).toEqual([expect.objectContaining({ code: 'TBSDK1002', fileName: '/game/src/unrelated.ts' })]);
  });

  it('throws one stable aggregate error for build-pipeline integration', () => {
    expect(() =>
      assertValidGameplayProgram({
        projectRoot: '/game',
        files: [{ fileName: '/game/src/bad.ts', sourceText: "fetch('/unsafe')" }],
      }),
    ).toThrow(InvalidGameplayProgramError);
    expect(() =>
      assertValidGameplayProgram({
        projectRoot: '/game',
        files: [{ fileName: '/game/src/bad.ts', sourceText: "fetch('/unsafe')" }],
      }),
    ).toThrow('TBSDK1002');
  });

  it('rejects Function/eval constructor escapes including computed aliases', () => {
    const diagnostics = validate(`
      const direct = (() => {}).constructor('return globalThis')();
      const key = 'constructor';
      const computed = (async () => {})[key]('return process')();
    `);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ code }) => code)).toEqual(['TBSDK1003', 'TBSDK1003']);
    expect(diagnostics.every(({ message }) => message.includes('dynamic code'))).toBe(true);
  });

  it('rejects reflective constructor retrieval including aliases and computed method names', () => {
    const diagnostics = validate(`
      const ctor = Reflect.get(() => {}, 'constructor');
      const get = Reflect.get;
      const method = 'getOwnPropertyDescriptor';
      const descriptor = Object[method](() => {}, 'constructor');
      void ctor;
      void get;
      void descriptor;
    `);

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map(({ code }) => code)).toEqual(['TBSDK1003', 'TBSDK1003', 'TBSDK1003']);
    expect(
      diagnostics.every(({ message }) => message.includes('reflective property retrieval')),
    ).toBe(true);
  });

  it('rejects reflection provenance and computed constructor escapes', () => {
    const diagnostics = validate(`
      { const R = Reflect; R.get(() => {}, 'constructor'); }
      { const { get } = Reflect; get(() => {}, 'constructor'); }
      { const O = Object; O.getOwnPropertyDescriptor(() => {}, 'constructor'); }
      { const { getOwnPropertyDescriptor } = Object; getOwnPropertyDescriptor(() => {}, 'constructor'); }
      (Reflect).get(() => {}, 'constructor');
      (() => {})[['con', 'structor'].join('')]('return globalThis')();
      declare const dynamicKey: string;
      (() => {})[dynamicKey]();
      {
        const prototype = Reflect.getPrototypeOf(() => {})!;
        const constructorKey = String('constructor');
        prototype[constructorKey]('return globalThis')();
      }
      {
        const prototype = Object.getPrototypeOf(() => {});
        const constructorKey = ['con', 'structor'].join('');
        prototype[constructorKey]('return globalThis')();
      }
    `);

    expect(diagnostics).toHaveLength(10);
    expect(diagnostics.every(({ code }) => code === 'TBSDK1003')).toBe(true);
  });
});

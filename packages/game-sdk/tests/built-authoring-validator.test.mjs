import { describe, expect, it } from 'vitest';

import { validateGameplayProgram } from '../dist/authoring/index.js';

const validateBuiltArtifact = (sourceText) =>
  validateGameplayProgram({
    projectRoot: '/game',
    files: [{ fileName: '/game/src/behavior.ts', sourceText }],
  });

const validateBuiltProgram = (files) =>
  validateGameplayProgram({
    projectRoot: '/game',
    files: files.map(([fileName, sourceText]) => ({
      fileName: `/game/src/${fileName}`,
      sourceText,
    })),
  });

describe('built authoring validator regressions', () => {
  it.each([
    ['named export-from', 'export { readFile } from "node:fs";'],
    ['export star', 'export * from "node:fs";'],
    ['import equals', 'import fs = require("node:fs"); void fs;'],
  ])('rejects forbidden modules through %s', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText).map(({ code }) => code)).toEqual(['TBSDK1001']);
  });

  it.each([
    ['aliased Math.random', 'const random = Math.random; random();'],
    ['computed Math.random', 'Math["random"]();'],
    ['aliased computed Math.random', 'const random = Math["random"]; random();'],
    ['Date call', 'Date();'],
    ['aliased Date.now', 'const now = Date.now; now();'],
    ['computed Date.now', 'Date["now"]();'],
    ['Math owner alias', 'const math = Math; math.random();'],
    ['Math.random destructuring', 'const { random } = Math; random();'],
    ['constant computed Math key', 'const key = "random"; Math[key]();'],
    ['Date owner alias', 'const Clock = Date; Clock.now();'],
    ['Date.now destructuring', 'const { now } = Date; now();'],
    ['dynamic Math key', 'declare const key: string; Math[key]();'],
  ])('rejects %s determinism violations', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText).map(({ code }) => code)).toEqual(['TBSDK1002']);
  });

  it('allows project-local bindings that shadow forbidden ambient names', () => {
    expect(
      validateBuiltArtifact(`
        const fetch = (value: number) => value + 1;
        fetch(1);
      `),
    ).toEqual([]);
  });

  it('still rejects the ambient global when a local shadow is scoped elsewhere', () => {
    expect(
      validateBuiltArtifact(`
        function safe() {
          const fetch = (value: number) => value + 1;
          return fetch(41);
        }
        fetch('/unsafe');
        export { safe };
      `).map(({ code }) => code),
    ).toEqual(['TBSDK1002']);
  });

  it.each([
    [
      'Math export/import alias',
      [
        ['owner.ts', 'export const math = Math;'],
        ['behavior.ts', 'import { math } from "./owner.js"; math.random();'],
      ],
    ],
    [
      'Date export/import alias',
      [
        ['owner.ts', 'export const Clock = Date;'],
        ['behavior.ts', 'import { Clock } from "./owner.js"; Clock.now();'],
      ],
    ],
  ])('rejects multi-file %s escape at its source', (_label, files) => {
    expect(validateBuiltProgram(files).map(({ code }) => code)).toEqual(['TBSDK1002']);
  });

  it.each([
    ['later Math assignment', 'let math; math = Math; math.random();'],
    ['later Date assignment', 'let Clock; Clock = Date; Clock.now();'],
    ['Math argument escape', 'declare function consume(value: unknown): void; consume(Math);'],
    ['Date return escape', 'const clock = () => Date; clock();'],
  ])('rejects %s as a first-class ambient value', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText).map(({ code }) => code)).toEqual(['TBSDK1002']);
  });

  it('preserves direct deterministic built-in members', () => {
    expect(validateBuiltArtifact('Math.floor(1.5); Date.parse("2026-01-01T00:00:00Z");')).toEqual(
      [],
    );
  });

  it('allows script-local Math and Date shadows as first-class values', () => {
    expect(
      validateBuiltArtifact(`
        const Math = { random: () => 0.5 };
        const Date = { now: () => 42 };
        const math = Math;
        let Clock;
        Clock = Date;
        math.random();
        Clock.now();
      `),
    ).toEqual([]);
  });

  it('allows locally shadowed Math and Date values to compose across files', () => {
    expect(
      validateBuiltProgram([
        [
          'owner.ts',
          'export const Math = { random: () => 0.5 }; export const Date = { now: () => 42 };',
        ],
        [
          'behavior.ts',
          'import { Math, Date } from "./owner.js"; const math = Math; const Clock = Date; math.random(); Clock.now();',
        ],
      ]),
    ).toEqual([]);
  });

  it.each([
    ['declare const Math', 'declare const Math: { random(): number }; Math.random();'],
    ['declare const Date', 'declare const Date: { now(): number }; Date.now();'],
    ['declare const fetch', 'declare const fetch: (url: string) => unknown; fetch("/unsafe");'],
    ['declare function fetch', 'declare function fetch(url: string): unknown; fetch("/unsafe");'],
  ])('does not treat erased %s as a safe runtime shadow', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText).map(({ code }) => code)).toEqual(['TBSDK1002']);
  });

  it.each([
    ['Math type reference', 'type MathShape = Math;'],
    ['Date type reference', 'type DateValue = Date;'],
    ['indexed access type', 'const floor: Math["floor"] = Math.floor;'],
    ['type query', 'type MathValue = typeof Math; type DateValue = typeof Date;'],
  ])('skips pure %s positions', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText)).toEqual([]);
  });

  it('continues to reject runtime typeof escape checks', () => {
    expect(validateBuiltArtifact('const mathKind = typeof Math;').map(({ code }) => code)).toEqual([
      'TBSDK1002',
    ]);
  });

  it('accepts real value-emitting local fetch declarations', () => {
    expect(
      validateBuiltArtifact(`
        function fetch(url: string) { return url.length; }
        const result = fetch('/safe');
        void result;
      `),
    ).toEqual([]);
  });

  it.each([
    ['Reflect.get call', "Reflect.get(() => {}, 'constructor')('return globalThis')();"],
    ['Reflect.get alias', "const get = Reflect.get; get(() => {}, 'constructor')('return globalThis')();"],
    ['computed Reflect.get', "const method = 'get'; Reflect[method](() => {}, 'constructor');"],
    ['Object descriptor', "Object.getOwnPropertyDescriptor(() => {}, 'constructor')?.value('return process')();"],
    ['computed Object descriptor alias', "const method = 'getOwnPropertyDescriptor'; const get = Object[method]; get(() => {}, 'constructor');"],
  ])('rejects %s reflective dynamic-code retrieval', (_label, sourceText) => {
    expect(validateBuiltArtifact(sourceText).map(({ code }) => code)).toEqual(['TBSDK1003']);
  });

  it('rejects reflection provenance and computed constructor bypasses', () => {
    const diagnostics = validateBuiltArtifact(`
      { const R = Reflect; R.get(() => {}, 'constructor'); }
      { const { get } = Reflect; get(() => {}, 'constructor'); }
      { const O = Object; O.getOwnPropertyDescriptor(() => {}, 'constructor'); }
      { const { getOwnPropertyDescriptor } = Object; getOwnPropertyDescriptor(() => {}, 'constructor'); }
      (Reflect).get(() => {}, 'constructor');
      (() => {})[['con', 'structor'].join('')]('return globalThis')();
      (() => {})['con' + 'structor']('return globalThis')();
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

    expect(diagnostics).toHaveLength(11);
    expect(diagnostics.every(({ code }) => code === 'TBSDK1003')).toBe(true);
  });
});

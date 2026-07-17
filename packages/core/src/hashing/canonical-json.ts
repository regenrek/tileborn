import { CanonicalJsonError } from '../errors/index.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const reject = (path: string, message: string): never => {
  throw new CanonicalJsonError({
    message: path.length > 0 ? `${path}: ${message}` : message,
  });
};

const assertSerializable = (value: unknown, path: string): void => {
  if (value === undefined) {
    reject(path, 'undefined is not serializable');
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      reject(path, 'non-finite numbers are not serializable');
    }
    return;
  }

  if (typeof value === 'bigint') {
    reject(path, 'bigint is not serializable');
  }

  if (value instanceof Date) {
    reject(path, 'Date is not serializable');
  }

  if (value instanceof Map) {
    reject(path, 'Map is not serializable');
  }

  if (value instanceof Set) {
    reject(path, 'Set is not serializable');
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    reject(path, `unsupported value type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) {
        reject(path, `sparse array hole at index ${index}`);
      }
      assertSerializable(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (!isPlainObject(value)) {
    reject(path, 'class instances and exotic objects are not serializable');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  for (const key of keys) {
    if (record[key] === undefined) {
      reject(path, `undefined property "${key}" is not serializable`);
    }
    assertSerializable(record[key], path.length > 0 ? `${path}.${key}` : key);
  }
};

/**
 * Stable JSON serializer used for content hashing.
 *
 * Rules:
 * - Object keys are sorted lexicographically.
 * - `undefined` values are rejected (not omitted silently).
 * - Arrays preserve element order and reject holes.
 * - Numbers use `Number.prototype.toString` (stable, no scientific drift for integers).
 * - `null`, booleans, and strings use JSON semantics.
 * - Rejects Date, Map, Set, class instances, sparse arrays, non-finite numbers, and BigInt.
 */
export const canonicalJson = (value: unknown): string => {
  assertSerializable(value, '');

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(',')}}`;
};

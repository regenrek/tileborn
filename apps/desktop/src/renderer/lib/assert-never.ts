/**
 * Compile-time exhaustiveness guard. Passing a value here is a type error unless
 * every variant of a discriminated union has already been handled, so adding a
 * new variant surfaces as a build failure at each unhandled `switch`. If reached
 * at runtime (e.g. via untyped data) it throws instead of silently continuing.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

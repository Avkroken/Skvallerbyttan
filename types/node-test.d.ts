declare module "node:assert/strict" {
  type RejectsBlock = () => unknown | Promise<unknown>;

  interface StrictAssert {
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    rejects(block: RejectsBlock | Promise<unknown>, error?: RegExp | object, message?: string | Error): Promise<void>;
  }

  const assert: StrictAssert;
  export default assert;
}

declare module "node:test" {
  type TestCallback = () => unknown | Promise<unknown>;
  type TestFunction = (name: string, callback: TestCallback) => void;

  const test: TestFunction;
  export default test;
}

declare module "node:module" {
  export function createRequire(filename: string | URL): (specifier: string) => unknown;
}

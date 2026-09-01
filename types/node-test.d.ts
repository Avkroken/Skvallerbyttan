declare module "node:assert/strict" {
  interface StrictAssert {
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): void;
  }

  const assert: StrictAssert;
  export default assert;
}

declare module "node:test" {
  interface TestContext {
    test(name: string, callback: TestCallback): Promise<void>;
  }

  type TestCallback = (context: TestContext) => unknown | Promise<unknown>;
  type TestFunction = (name: string, callback: TestCallback) => Promise<void>;

  const test: TestFunction;
  export default test;
}

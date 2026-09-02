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
  interface TestOptions {
    concurrency?: boolean | number;
    only?: boolean;
    signal?: AbortSignal;
    skip?: boolean | string;
    timeout?: number;
    todo?: boolean | string;
  }

  type TestCallback =
    | ((context: TestContext) => unknown | Promise<unknown>)
    | ((context: TestContext, done: (result?: unknown) => void) => unknown);

  interface TestContext {
    test(callback: TestCallback): Promise<void>;
    test(options: TestOptions, callback: TestCallback): Promise<void>;
    test(name: string, callback: TestCallback): Promise<void>;
    test(name: string, options: TestOptions, callback?: TestCallback): Promise<void>;
  }

  interface TestFunction {
    (callback: TestCallback): Promise<void>;
    (options: TestOptions, callback: TestCallback): Promise<void>;
    (name: string, callback: TestCallback): Promise<void>;
    (name: string, options: TestOptions, callback?: TestCallback): Promise<void>;
  }

  const test: TestFunction;
  export default test;
}

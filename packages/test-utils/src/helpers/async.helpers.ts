/**
 * Async test helpers for waiting and retrying.
 *
 * @example
 * import { flushPromises, waitForCondition, waitForDomElement, retry } from "@kitelev/exocortex-test-utils";
 *
 * // Flush microtask queue
 * await flushPromises();
 *
 * // Wait for condition
 * await waitForCondition(() => service.isReady);
 *
 * // Wait for DOM element
 * const element = await waitForDomElement(container, '.my-class');
 *
 * // Retry with exponential backoff
 * await retry(() => expect(value).toBe(true));
 */

/**
 * Flushes the microtask queue by waiting for all pending promises to resolve.
 * Use this instead of `await new Promise(resolve => setTimeout(resolve, 0))`.
 *
 * @example
 * // ❌ WRONG - Fixed timeout
 * await new Promise(resolve => setTimeout(resolve, 50));
 *
 * // ✅ CORRECT - Flush microtasks
 * await flushPromises();
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Waits for React to complete rendering by running multiple microtask cycles.
 * Use this for UI tests where React components need time to render.
 *
 * @param cycles - Number of microtask cycles to wait (default: 10)
 * @returns Promise that resolves after React has had time to render
 *
 * @example
 * // ❌ WRONG - Single flush may not be enough for React
 * await flushPromises();
 *
 * // ✅ CORRECT - Multiple cycles for React rendering
 * await waitForReact();
 */
export async function waitForReact(cycles: number = 10): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await flushPromises();
  }
}

/**
 * Options for waitForCondition.
 */
export interface WaitForConditionOptions {
  /** Maximum time to wait in ms (default: 5000) */
  timeout?: number;
  /** Polling interval in ms (default: 50) */
  interval?: number;
  /** Custom error message on timeout */
  message?: string;
}

/**
 * Waits until a condition function returns true, with configurable timeout and interval.
 * Use this instead of fixed `setTimeout` delays when waiting for async state changes.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Configuration options
 * @throws Error if condition is not met within timeout
 *
 * @example
 * // ❌ WRONG - Fixed timeout that may be too short or too long
 * await new Promise(resolve => setTimeout(resolve, 200));
 * expect(service.isReady).toBe(true);
 *
 * // ✅ CORRECT - Wait for actual condition
 * await waitForCondition(() => service.isReady);
 * expect(service.isReady).toBe(true);
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: WaitForConditionOptions = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 50,
    message = "Condition not met within timeout",
  } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`${message} (waited ${timeout}ms)`);
}

/**
 * Options for waitForDomElement.
 */
export interface WaitForDomElementOptions {
  /** Maximum time to wait in ms (default: 5000) */
  timeout?: number;
  /** Polling interval in ms (default: 50) */
  interval?: number;
}

/**
 * Waits for a DOM element to appear, with configurable timeout.
 * Use this instead of fixed delays when waiting for React to render.
 *
 * @param container - The container element to search in
 * @param selector - CSS selector for the element to wait for
 * @param options - Configuration options
 * @returns The found element
 * @throws Error if element is not found within timeout
 *
 * @example
 * // ❌ WRONG - Fixed timeout hoping React has rendered
 * await new Promise(resolve => setTimeout(resolve, 200));
 * expect(domContainer.querySelector('.my-class')).toBeTruthy();
 *
 * // ✅ CORRECT - Wait for actual DOM element
 * const element = await waitForDomElement(domContainer, '.my-class');
 * expect(element).toBeTruthy();
 */
export async function waitForDomElement(
  container: Element,
  selector: string,
  options: WaitForDomElementOptions = {}
): Promise<Element> {
  const { timeout = 5000, interval = 50 } = options;

  await waitForCondition(() => container.querySelector(selector) !== null, {
    timeout,
    interval,
    message: `Element "${selector}" not found`,
  });

  const element = container.querySelector(selector);
  if (!element) {
    throw new Error(`Element "${selector}" not found after wait`);
  }
  return element;
}

/**
 * Waits for multiple DOM elements to appear.
 *
 * @param container - The container element to search in
 * @param selector - CSS selector for the elements to wait for
 * @param minCount - Minimum number of elements to wait for (default: 1)
 * @param options - Configuration options
 * @returns NodeList of found elements
 */
export async function waitForDomElements(
  container: Element,
  selector: string,
  minCount: number = 1,
  options: WaitForDomElementOptions = {}
): Promise<NodeListOf<Element>> {
  const { timeout = 5000, interval = 50 } = options;

  await waitForCondition(
    () => container.querySelectorAll(selector).length >= minCount,
    {
      timeout,
      interval,
      message: `Expected at least ${minCount} elements matching "${selector}"`,
    }
  );

  return container.querySelectorAll(selector);
}

/**
 * Waits for a DOM element to be removed.
 *
 * @param container - The container element to search in
 * @param selector - CSS selector for the element that should be removed
 * @param options - Configuration options
 */
export async function waitForDomElementRemoval(
  container: Element,
  selector: string,
  options: WaitForDomElementOptions = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;

  await waitForCondition(() => container.querySelector(selector) === null, {
    timeout,
    interval,
    message: `Element "${selector}" was not removed`,
  });
}

/**
 * Options for retry.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  retries?: number;
  /** Initial delay between retries in ms (default: 100) */
  delay?: number;
  /** Backoff multiplier (default: 2) */
  backoff?: number;
}

/**
 * Retries an async function with exponential backoff.
 * Use this for operations that may fail transiently (network, file I/O).
 *
 * @param fn - Async function to retry
 * @param options - Configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * // ❌ WRONG - Fixed retries with constant delay
 * for (let i = 0; i < 10; i++) {
 *   if (condition) break;
 *   await sleep(50);
 * }
 *
 * // ✅ CORRECT - Exponential backoff retry
 * await retry(() => {
 *   expect(condition).toBe(true);
 * }, { retries: 3, delay: 100, backoff: 2 });
 */
export async function retry<T>(
  fn: () => T | Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, delay = 100, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(backoff, i))
        );
      }
    }
  }

  throw lastError;
}

/**
 * Creates a delayed promise for testing timeouts.
 * Prefer waitForCondition over this for actual tests.
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a promise that rejects after a timeout.
 * Useful for testing timeout handling.
 *
 * @param ms - Milliseconds until rejection
 * @param message - Error message
 * @returns Promise that rejects after the timeout
 */
export function rejectAfter(ms: number, message: string = "Timeout"): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
}

/**
 * Races a promise against a timeout.
 * Useful for ensuring tests don't hang.
 *
 * @param promise - The promise to race
 * @param ms - Maximum time to wait
 * @param message - Error message on timeout
 * @returns The result of the promise
 * @throws Error if the timeout is reached
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string = "Operation timed out"
): Promise<T> {
  return Promise.race([promise, rejectAfter(ms, message)]) as Promise<T>;
}

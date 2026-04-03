/**
 * Minimal reflect-metadata shim for TSyringe DI container.
 *
 * TSyringe only uses three Reflect methods:
 * - Reflect.getMetadata(key, target)
 * - Reflect.getOwnMetadata(key, target)
 * - Reflect.defineMetadata(key, value, target)
 *
 * This shim replaces the full reflect-metadata polyfill (24 KB)
 * with a ~400 byte implementation that covers exactly these methods.
 */

const metadataStore = new WeakMap<
  object,
  Map<string | symbol, unknown>
>();

function getMap(target: object): Map<string | symbol, unknown> {
  let map = metadataStore.get(target);
  if (!map) {
    map = new Map();
    metadataStore.set(target, map);
  }
  return map;
}

if (typeof Reflect === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as Record<string, any>).Reflect = {};
}

if (!Reflect.getMetadata) {
  Reflect.getMetadata = function (key: string | symbol, target: object): unknown {
    let current: object | null = target;
    while (current) {
      const map = metadataStore.get(current);
      if (map && map.has(key)) return map.get(key);
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  };
}

if (!Reflect.getOwnMetadata) {
  Reflect.getOwnMetadata = function (key: string | symbol, target: object): unknown {
    const map = metadataStore.get(target);
    return map ? map.get(key) : undefined;
  };
}

if (!Reflect.defineMetadata) {
  Reflect.defineMetadata = function (
    key: string | symbol,
    value: unknown,
    target: object,
  ): void {
    getMap(target).set(key, value);
  };
}

if (!Reflect.hasOwnMetadata) {
  Reflect.hasOwnMetadata = function (key: string | symbol, target: object): boolean {
    const map = metadataStore.get(target);
    return map ? map.has(key) : false;
  };
}

if (!Reflect.metadata) {
  Reflect.metadata = function (key: string | symbol, value: unknown) {
    return function (target: object) {
      getMap(target).set(key, value);
    };
  };
}

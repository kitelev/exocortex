/**
 * FunctionReplacer - Type-safe method interception wrapper
 *
 * Provides a mechanism to replace prototype methods while maintaining:
 * - Type safety through generics
 * - Proper `this` context preservation
 * - Clean enable/disable lifecycle
 * - Access to original method for fallback
 *
 * Based on the pattern from obsidian-front-matter-title:
 * https://github.com/snezhig/obsidian-front-matter-title
 *
 * @example
 * ```typescript
 * const replacer = FunctionReplacer.create(
 *   GraphNodePrototype,
 *   "getDisplayText",
 *   { resolver: myResolver },
 *   function(args, defaultArgs, vanilla) {
 *     const text = args.resolver.resolve(this.id);
 *     return text ?? vanilla.call(this, ...defaultArgs);
 *   }
 * );
 * replacer.enable();
 * // ... later ...
 * replacer.disable();
 * ```
 */

/**
 * Extract function property names from a type
 */
export type FunctionPropertyNames<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T] &
  string;

/**
 * Implementation function type
 *
 * @param args - Custom arguments passed during creation
 * @param defaultArgs - Arguments passed to the original method call
 * @param vanilla - The original (unpatched) method
 */
export type ReplacementImplementation<
  Target,
  Method extends FunctionPropertyNames<Required<Target>>,
  Args,
> = (
  this: Target,
  args: Args,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultArgs: Target[Method] extends (...arg: any) => any ? Parameters<Target[Method]> : unknown[],
  vanilla: Target[Method]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any;

/**
 * FunctionReplacer - Method interception wrapper
 *
 * Allows replacing a method on a target object (typically a prototype)
 * with a custom implementation while preserving access to the original.
 */
export class FunctionReplacer<
  Target,
  Method extends FunctionPropertyNames<Required<Target>>,
  Args,
> {
  private vanilla: Target[Method] | null = null;

  private constructor(
    private readonly target: Target,
    private readonly method: Method,
    private readonly args: Args,
    private readonly implementation: ReplacementImplementation<Target, Method, Args>
  ) {
    this.validate();
  }

  /**
   * Factory method to create a FunctionReplacer instance
   *
   * @param target - The object containing the method to replace (usually a prototype)
   * @param method - The name of the method to replace
   * @param args - Custom arguments to pass to the implementation
   * @param implementation - The replacement function
   */
  public static create<
    Target,
    Method extends FunctionPropertyNames<Required<Target>>,
    Args,
  >(
    target: Target,
    method: Method,
    args: Args,
    implementation: ReplacementImplementation<Target, Method, Args>
  ): FunctionReplacer<Target, Method, Args> {
    return new FunctionReplacer(target, method, args, implementation);
  }

  /**
   * Get the target object
   */
  public getTarget(): Target {
    return this.target;
  }

  /**
   * Enable the replacement
   *
   * @returns true if enabled successfully, false if already enabled
   */
  public enable(): boolean {
    if (this.vanilla !== null) {
      return false;
    }

    // Store reference to this FunctionReplacer for use in closure
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // Store original method
    this.vanilla = this.target[this.method];

    // Replace with wrapper that calls our implementation
    // Using function() syntax (not arrow) to preserve `this` context of the target
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.target[this.method] = function (this: Target, ...callArgs: any[]): any {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return self.implementation.call(this, self.args, callArgs as any, self.vanilla as any);
    } as Target[Method];

    return true;
  }

  /**
   * Disable the replacement and restore original method
   */
  public disable(): void {
    if (this.vanilla !== null) {
      this.target[this.method] = this.vanilla;
      this.vanilla = null;
    }
  }

  /**
   * Check if the replacement is currently enabled
   */
  public isEnabled(): boolean {
    return this.vanilla !== null;
  }

  /**
   * Validate that the target method is actually a function
   */
  private validate(): void {
    if (typeof this.target[this.method] !== "function") {
      throw new Error(`Method ${String(this.method)} is not a function`);
    }
  }
}

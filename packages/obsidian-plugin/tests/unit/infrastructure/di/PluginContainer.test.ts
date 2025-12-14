import "reflect-metadata";
import { container } from "tsyringe";
import { PluginContainer } from "../../../../src/infrastructure/di/PluginContainer";
import { DI_TOKENS } from "exocortex";
import { App, Plugin } from "obsidian";

describe("PluginContainer", () => {
  let mockApp: App;
  let mockPlugin: Plugin;

  beforeEach(() => {
    container.clearInstances();

    mockApp = {
      vault: {
        getName: jest.fn().mockReturnValue("Test Vault"),
      } as any,
      metadataCache: {} as any,
    } as App;

    mockPlugin = {
      manifest: { id: "test-plugin" },
    } as Plugin;
  });

  afterEach(() => {
    container.clearInstances();
  });

  it("should setup DI container with all required bindings", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    expect(() => container.resolve(DI_TOKENS.ILogger)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.IEventBus)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.IConfiguration)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.INotificationService)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.IVaultAdapter)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.IVaultContext)).not.toThrow();
    expect(() => container.resolve(DI_TOKENS.IMultiVaultManager)).not.toThrow();
  });

  it("should resolve IVaultContext with vault identity", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const vaultContext = container.resolve(DI_TOKENS.IVaultContext);

    expect(vaultContext).toBeDefined();
    expect(vaultContext.vaultId).toBe("Test Vault");
    expect(vaultContext.vaultName).toBe("Test Vault");
    expect(vaultContext.vaultAdapter).toBeDefined();
    expect(vaultContext.isActive).toBe(true);
  });

  it("should resolve IMultiVaultManager with single vault", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const manager = container.resolve(DI_TOKENS.IMultiVaultManager);

    expect(manager).toBeDefined();
    expect(typeof manager.getCurrentVault).toBe("function");
    expect(typeof manager.listVaults).toBe("function");
    expect(manager.getVaultCount()).toBe(1);
  });

  it("should resolve ILogger implementation", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const logger = container.resolve(DI_TOKENS.ILogger);

    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("should resolve IEventBus implementation", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const eventBus = container.resolve(DI_TOKENS.IEventBus);

    expect(eventBus).toBeDefined();
    expect(typeof eventBus.publish).toBe("function");
    expect(typeof eventBus.subscribe).toBe("function");
    expect(typeof eventBus.unsubscribe).toBe("function");
  });

  it("should resolve IConfiguration implementation", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const config = container.resolve(DI_TOKENS.IConfiguration);

    expect(config).toBeDefined();
    expect(typeof config.get).toBe("function");
    expect(typeof config.set).toBe("function");
    expect(typeof config.getAll).toBe("function");
  });

  it("should resolve INotificationService implementation", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const notifications = container.resolve(DI_TOKENS.INotificationService);

    expect(notifications).toBeDefined();
    expect(typeof notifications.info).toBe("function");
    expect(typeof notifications.success).toBe("function");
    expect(typeof notifications.error).toBe("function");
    expect(typeof notifications.warn).toBe("function");
    expect(typeof notifications.confirm).toBe("function");
  });

  it("should clear container instances on reset", () => {
    PluginContainer.setup(mockApp, mockPlugin);

    const logger1 = container.resolve(DI_TOKENS.ILogger);

    PluginContainer.reset();

    // After reset, registrations remain but instances are cleared
    // Need to re-setup to use container again
    PluginContainer.setup(mockApp, mockPlugin);
    const logger2 = container.resolve(DI_TOKENS.ILogger);

    // New instance created after reset
    expect(logger2).toBeDefined();
  });
});

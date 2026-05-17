import {
  DEFAULT_LOG_CHANNELS,
  DEFAULT_SETTINGS,
  type LogChannelsSettings,
} from "../../src/domain/settings/ExocortexSettings";

describe("LogChannelSettings", () => {
  describe("DEFAULT_LOG_CHANNELS", () => {
    it("should have all four log levels", () => {
      expect(DEFAULT_LOG_CHANNELS).toHaveProperty("debug");
      expect(DEFAULT_LOG_CHANNELS).toHaveProperty("info");
      expect(DEFAULT_LOG_CHANNELS).toHaveProperty("warn");
      expect(DEFAULT_LOG_CHANNELS).toHaveProperty("error");
    });

    it("should default debug to console only (no file persistence)", () => {
      expect(DEFAULT_LOG_CHANNELS.debug).toEqual({ notice: false, console: true, file: false });
    });

    it("should default info to console only (no file persistence)", () => {
      expect(DEFAULT_LOG_CHANNELS.info).toEqual({ notice: false, console: true, file: false });
    });

    it("should default warn to notice + console + file", () => {
      expect(DEFAULT_LOG_CHANNELS.warn).toEqual({ notice: true, console: true, file: true });
    });

    it("should default error to notice + console + file", () => {
      expect(DEFAULT_LOG_CHANNELS.error).toEqual({ notice: true, console: true, file: true });
    });

    it("should disable file channel by default for diagnostic levels (debug, info)", () => {
      const diagnosticLevels: (keyof LogChannelsSettings)[] = ["debug", "info"];
      for (const level of diagnosticLevels) {
        expect(DEFAULT_LOG_CHANNELS[level].file).toBe(false);
      }
    });

    it("should enable file channel by default for actionable levels (warn, error)", () => {
      const actionableLevels: (keyof LogChannelsSettings)[] = ["warn", "error"];
      for (const level of actionableLevels) {
        expect(DEFAULT_LOG_CHANNELS[level].file).toBe(true);
      }
    });
  });

  describe("DEFAULT_SETTINGS", () => {
    it("should include logChannels with default values", () => {
      expect(DEFAULT_SETTINGS.logChannels).toEqual(DEFAULT_LOG_CHANNELS);
    });
  });
});

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

    it("should default debug to console only", () => {
      expect(DEFAULT_LOG_CHANNELS.debug).toEqual({ notice: false, console: true, file: false });
    });

    it("should default info to console only", () => {
      expect(DEFAULT_LOG_CHANNELS.info).toEqual({ notice: false, console: true, file: false });
    });

    it("should default warn to notice + console", () => {
      expect(DEFAULT_LOG_CHANNELS.warn).toEqual({ notice: true, console: true, file: false });
    });

    it("should default error to notice + console", () => {
      expect(DEFAULT_LOG_CHANNELS.error).toEqual({ notice: true, console: true, file: false });
    });

    it("should not enable file channel by default for any level", () => {
      const levels = Object.keys(DEFAULT_LOG_CHANNELS) as (keyof LogChannelsSettings)[];
      for (const level of levels) {
        expect(DEFAULT_LOG_CHANNELS[level].file).toBe(false);
      }
    });
  });

  describe("DEFAULT_SETTINGS", () => {
    it("should include logChannels with default values", () => {
      expect(DEFAULT_SETTINGS.logChannels).toEqual(DEFAULT_LOG_CHANNELS);
    });
  });
});

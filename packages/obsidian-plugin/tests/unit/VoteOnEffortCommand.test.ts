import { VoteOnEffortCommand } from "../../src/application/commands/VoteOnEffortCommand";
import { TFile, Notice } from "obsidian";
import { EffortVotingService, CommandVisibilityContext, LoggingService } from "exocortex";
import { flushPromises } from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canVoteOnEffort: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("VoteOnEffortCommand", () => {
  let command: VoteOnEffortCommand;
  let mockEffortVotingService: jest.Mocked<EffortVotingService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock effort voting service
    mockEffortVotingService = {
      incrementEffortVotes: jest.fn(),
    } as unknown as jest.Mocked<EffortVotingService>;

    // Create mock file
    mockFile = {
      path: "test-effort.md",
      basename: "test-effort",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Effort",
      status: "InProgress",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new VoteOnEffortCommand(mockEffortVotingService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("vote-on-effort");
      expect(command.name).toBe("Vote on effort");
    });
  });

  describe("checkCallback", () => {
    const mockCanVoteOnEffort = require("exocortex").canVoteOnEffort;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockEffortVotingService.incrementEffortVotes).not.toHaveBeenCalled();
    });

    it("should return false when canVoteOnEffort returns false", () => {
      mockCanVoteOnEffort.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockEffortVotingService.incrementEffortVotes).not.toHaveBeenCalled();
    });

    it("should return true when canVoteOnEffort returns true and checking is true", () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockEffortVotingService.incrementEffortVotes).not.toHaveBeenCalled();
    });

    it("should execute command and show vote count when checking is false", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      mockEffortVotingService.incrementEffortVotes.mockResolvedValue(5);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Voted! New vote count: 5");
    });

    it("should handle first vote correctly", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      mockEffortVotingService.incrementEffortVotes.mockResolvedValue(1);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Voted! New vote count: 1");
    });

    it("should handle large vote counts", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      mockEffortVotingService.incrementEffortVotes.mockResolvedValue(9999);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Voted! New vote count: 9999");
    });

    it("should handle errors and show notice", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      const error = new Error("Failed to record vote");
      mockEffortVotingService.incrementEffortVotes.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Vote on effort error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to vote: Failed to record vote");
    });

    it("should handle concurrent votes", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      mockEffortVotingService.incrementEffortVotes.mockResolvedValue(10);

      // Execute multiple votes concurrently
      const result1 = command.checkCallback(false, mockFile, mockContext);
      const result2 = command.checkCallback(false, mockFile, mockContext);
      const result3 = command.checkCallback(false, mockFile, mockContext);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledWith("Voted! New vote count: 10");
    });

    it("should handle file system errors", async () => {
      mockCanVoteOnEffort.mockReturnValue(true);
      const fsError = new Error("File is read-only");
      mockEffortVotingService.incrementEffortVotes.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockEffortVotingService.incrementEffortVotes).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Vote on effort error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to vote: File is read-only");
    });

    it("should handle non-Effort context", () => {
      mockCanVoteOnEffort.mockReturnValue(false);
      const taskContext = { ...mockContext, instanceClass: "Task" };
      const result = command.checkCallback(true, mockFile, taskContext);
      expect(result).toBe(false);
    });

    it("should handle archived Effort context", () => {
      mockCanVoteOnEffort.mockReturnValue(false);
      const archivedContext = { ...mockContext, archived: true };
      const result = command.checkCallback(true, mockFile, archivedContext);
      expect(result).toBe(false);
    });
  });
});
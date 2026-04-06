import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canVoteOnEffort,
  EffortVotingService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class VoteOnEffortCommand implements ICommand {
  id = "vote-on-effort";
  name = "Vote on effort";

  constructor(
    private effortVotingService: EffortVotingService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canVoteOnEffort(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to vote: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Vote on effort error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    const newVoteCount = await this.effortVotingService.incrementEffortVotes(file);
    this.notifier.success(`Voted! New vote count: ${newVoteCount}`);
  }
}

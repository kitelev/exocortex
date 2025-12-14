import { injectable } from "tsyringe";
import { AssetClass, EffortStatus } from "../domain/constants";

@injectable()
export class EffortStatusWorkflow {
  getPreviousStatus(
    currentStatus: string,
    instanceClass: string | string[] | null,
  ): string | null | undefined {
    const normalizedStatus = this.normalizeStatus(currentStatus);

    if (normalizedStatus === EffortStatus.DRAFT) {
      return null;
    }

    if (normalizedStatus === EffortStatus.BACKLOG) {
      return this.wrapStatus(EffortStatus.DRAFT);
    }

    if (normalizedStatus === EffortStatus.ANALYSIS) {
      return this.wrapStatus(EffortStatus.BACKLOG);
    }

    if (normalizedStatus === EffortStatus.TODO) {
      return this.wrapStatus(EffortStatus.ANALYSIS);
    }

    if (normalizedStatus === EffortStatus.DOING) {
      const isProject = this.hasInstanceClass(
        instanceClass,
        AssetClass.PROJECT,
      );
      return isProject
        ? this.wrapStatus(EffortStatus.TODO)
        : this.wrapStatus(EffortStatus.BACKLOG);
    }

    if (normalizedStatus === EffortStatus.DONE) {
      return this.wrapStatus(EffortStatus.DOING);
    }

    return undefined;
  }

  normalizeStatus(status: string): string {
    return status.replace(/["'[\]]/g, "").trim();
  }

  wrapStatus(status: string): string {
    return `"[[${status}]]"`;
  }

  private hasInstanceClass(
    instanceClass: string | string[] | null,
    targetClass: AssetClass,
  ): boolean {
    if (!instanceClass) return false;

    const classes = Array.isArray(instanceClass)
      ? instanceClass
      : [instanceClass];
    return classes.some(
      (cls) => cls.replace(/["'[\]]/g, "").trim() === targetClass,
    );
  }
}

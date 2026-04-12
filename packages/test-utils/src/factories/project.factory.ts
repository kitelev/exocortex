/**
 * Project factory for creating test data.
 *
 * @example
 * // Simple project
 * const project = ProjectFactory.create();
 *
 * // Project with specific status
 * const doingProject = ProjectFactory.doing();
 */

import type {
  ProjectFixture,
  FileInfo,
  Metadata,
} from "../types";
import { normalizeStatus } from "../helpers/status.helpers";

let projectCounter = 0;

/**
 * Reset the project counter. Call this in beforeEach() to ensure deterministic IDs.
 */
export function resetProjectCounter(): void {
  projectCounter = 0;
}

/**
 * Generate a unique ID for projects.
 */
function generateId(): string {
  projectCounter++;
  return `project-${projectCounter}`;
}

/**
 * Default project fixture values.
 */
const DEFAULT_PROJECT: Omit<ProjectFixture, "path" | "basename" | "label"> = {
  status: "ems__EffortStatusDraft",
  votes: 0,
  isArchived: false,
  createdAt: Date.now(),
};

/**
 * Project factory for creating test fixtures.
 */
export const ProjectFactory = {
  /**
   * Create a project fixture with optional overrides.
   */
  create(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    const id = generateId();
    const basename = overrides.basename ?? id;
    const normalizedStatus = normalizeStatus(
      overrides.status ?? DEFAULT_PROJECT.status
    );

    return {
      path: overrides.path ?? `projects/${basename}.md`,
      basename,
      label: overrides.label ?? `Test Project ${projectCounter}`,
      status: normalizedStatus,
      votes: overrides.votes ?? DEFAULT_PROJECT.votes,
      area: overrides.area,
      parent: overrides.parent,
      isArchived: overrides.isArchived ?? DEFAULT_PROJECT.isArchived,
      createdAt: overrides.createdAt ?? DEFAULT_PROJECT.createdAt,
      blockers: overrides.blockers,
    };
  },

  /**
   * Create multiple project fixtures.
   */
  createMany(count: number, overrides: Partial<ProjectFixture> = {}): ProjectFixture[] {
    return Array.from({ length: count }, () => ProjectFactory.create(overrides));
  },

  // Convenience methods for common states

  /**
   * Create a Draft project.
   */
  draft(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Draft", ...overrides });
  },

  /**
   * Create a Backlog project.
   */
  backlog(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Backlog", ...overrides });
  },

  /**
   * Create an Analysis project.
   */
  analysis(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Analysis", ...overrides });
  },

  /**
   * Create a To Do project.
   */
  todo(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "To Do", ...overrides });
  },

  /**
   * Create a Doing project.
   */
  doing(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Doing", ...overrides });
  },

  /**
   * Create a Done project.
   */
  done(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Done", ...overrides });
  },

  /**
   * Create a Trashed project.
   */
  trashed(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ status: "Trashed", ...overrides });
  },

  /**
   * Create an archived project (Done + isArchived).
   */
  archived(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.done({ isArchived: true, ...overrides });
  },

  /**
   * Create a blocked project.
   */
  blocked(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    const blockerProject = ProjectFactory.create();
    return ProjectFactory.create({
      blockers: [blockerProject.path],
      ...overrides,
    });
  },

  /**
   * Create a project with votes.
   */
  withVotes(votes: number, overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ votes, ...overrides });
  },

  /**
   * Create a project under a parent initiative/project.
   */
  withParent(parent: string, overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ parent, ...overrides });
  },

  /**
   * Create a project in an area.
   */
  inArea(area: string, overrides: Partial<ProjectFixture> = {}): ProjectFixture {
    return ProjectFactory.create({ area, ...overrides });
  },

  // Metadata conversion

  /**
   * Convert a ProjectFixture to frontmatter metadata format.
   */
  toMetadata(fixture: ProjectFixture): Metadata {
    const normalizedStatus = normalizeStatus(fixture.status);
    const metadata: Metadata = {
      exo__Instance_class: "[[ems__Project]]",
      exo__Asset_label: fixture.label,
      exo__Asset_uid: fixture.basename,
      exo__Asset_createdAt: fixture.createdAt,
      exo__Asset_isArchived: fixture.isArchived,
      ems__Effort_status: `[[${normalizedStatus}]]`,
    };

    if (fixture.votes !== undefined && fixture.votes > 0) {
      metadata.ems__Effort_votes = fixture.votes;
    }

    if (fixture.area) {
      metadata.ems__Effort_area = `[[${fixture.area}]]`;
    }

    if (fixture.parent) {
      metadata.ems__Effort_parent = `[[${fixture.parent}]]`;
    }

    if (fixture.blockers && fixture.blockers.length > 0) {
      metadata.ems__Project_blockedBy = fixture.blockers.map((b) => `[[${b}]]`);
    }

    return metadata;
  },

  /**
   * Convert a ProjectFixture to a TFile-like object.
   */
  toFile(fixture: ProjectFixture): FileInfo & { stat: object; vault: null; parent: null; extension: string } {
    return {
      path: fixture.path,
      basename: fixture.basename,
      name: `${fixture.basename}.md`,
      extension: "md",
      parent: null,
      vault: null,
      stat: {
        ctime: fixture.createdAt ?? Date.now(),
        mtime: Date.now(),
        size: 0,
      },
    };
  },
};

export default ProjectFactory;

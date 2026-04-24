import {
  UI_ONTOLOGY_FILES,
  UiOntologyBootstrapper,
  type UiOntologyBootstrapperVault,
} from "../../../../src/infrastructure/ontology/UiOntologyBootstrapper";

interface FakeVault extends UiOntologyBootstrapperVault {
  files: Map<string, string>;
  folders: Set<string>;
  createdPaths: string[];
  ensuredFolders: string[];
  existingUids: Set<string>;
}

const UUID_BASENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeVault(
  existingPaths: Iterable<string> = [],
  existingUids: Iterable<string> = [],
): FakeVault {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const createdPaths: string[] = [];
  const ensuredFolders: string[] = [];
  const uids = new Set<string>(existingUids);

  for (const path of existingPaths) {
    files.set(path, "existing-stub");
    const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
    if (UUID_BASENAME_RE.test(basename)) uids.add(basename);
  }

  return {
    files,
    folders,
    createdPaths,
    ensuredFolders,
    existingUids: uids,
    hasAssetWithUid(uid) {
      return uids.has(uid);
    },
    fileExists(path) {
      return files.has(path);
    },
    async createFile(path, content) {
      if (files.has(path)) {
        throw new Error(`duplicate create for ${path}`);
      }
      files.set(path, content);
      createdPaths.push(path);
    },
    async ensureFolder(path) {
      folders.add(path);
      ensuredFolders.push(path);
    },
  };
}

const TARGET_FOLDER = "_exocortex-ui-ontology";

const BUNDLED_UIDS = [
  "3ee15e1b-3725-4497-9946-df0b67b63f29", // !ui ontology root
  "97fc9862-c886-4d86-9a60-e0cf9d778575", // ui__RelationColumnSet class
  "3382b5cd-5d4d-4aaa-b55f-d6af85c4ee13", // _label
  "7ca5816a-f95a-40bf-ba94-c00081ce3b9f", // _priority
  "d0aa1baa-be37-4258-b3e7-9f6e5fd63722", // _targetClass
  "d0aa8c6a-dcc4-4c73-883a-9bd5c27a3a31", // _referencingProperty
  "dc6da098-db18-4e75-8758-6a7779289d8a", // _columns
] as const;

const FIXTURE_UID = "7e2d4e3e-1e9d-461a-8baa-4792949919cd"; // MVG fixture — NOT bundled

describe("UiOntologyBootstrapper", () => {
  describe("UI_ONTOLOGY_FILES static manifest", () => {
    it("bundles exactly 7 ontology files", () => {
      expect(UI_ONTOLOGY_FILES).toHaveLength(7);
    });

    it("covers all 7 canonical UUIDs", () => {
      const uids = UI_ONTOLOGY_FILES.map((f) => f.uid).sort();
      expect(uids).toEqual([...BUNDLED_UIDS].sort());
    });

    it("does NOT bundle the Task←Project MVG fixture (example data, not ontology)", () => {
      const uids = UI_ONTOLOGY_FILES.map((f) => f.uid);
      expect(uids).not.toContain(FIXTURE_UID);
    });

    it("each file has a UUID basename and a non-empty markdown body", () => {
      for (const file of UI_ONTOLOGY_FILES) {
        expect(file.uid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(file.filename).toBe(`${file.uid}.md`);
        expect(file.content.length).toBeGreaterThan(0);
        expect(file.content).toContain(`exo__Asset_uid: ${file.uid}`);
      }
    });

    it("each file references the !ui ontology root (except the root itself)", () => {
      const ROOT = "3ee15e1b-3725-4497-9946-df0b67b63f29";
      for (const file of UI_ONTOLOGY_FILES) {
        if (file.uid === ROOT) continue;
        expect(file.content).toContain(
          `exo__Asset_isDefinedBy: "[[${ROOT}|!ui]]"`,
        );
      }
    });

    it("property files use snake_case exo__Asset_label matching Task 3 convention", () => {
      // Regression guard for feedback_starter_kit_ontology_label_snake_case.md
      const propertyUids = new Set([
        "3382b5cd-5d4d-4aaa-b55f-d6af85c4ee13",
        "7ca5816a-f95a-40bf-ba94-c00081ce3b9f",
        "d0aa1baa-be37-4258-b3e7-9f6e5fd63722",
        "d0aa8c6a-dcc4-4c73-883a-9bd5c27a3a31",
        "dc6da098-db18-4e75-8758-6a7779289d8a",
      ]);
      for (const file of UI_ONTOLOGY_FILES) {
        if (!propertyUids.has(file.uid)) continue;
        expect(file.content).toMatch(
          /exo__Asset_label: "ui__RelationColumnSet_[a-zA-Z]+"/,
        );
      }
    });
  });

  describe("bootstrap() — empty vault", () => {
    it("creates target folder + all 7 files when vault is empty", async () => {
      const vault = makeVault();
      const bootstrapper = new UiOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(7);
      expect(result.skipped).toHaveLength(0);
      expect(vault.ensuredFolders).toContain(TARGET_FOLDER);
      expect(vault.createdPaths).toHaveLength(7);
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`${TARGET_FOLDER}/${uid}.md`)).toBe(true);
      }
    });

    it("written file content matches the bundled manifest verbatim", async () => {
      const vault = makeVault();
      const bootstrapper = new UiOntologyBootstrapper(vault);

      await bootstrapper.bootstrap();

      for (const file of UI_ONTOLOGY_FILES) {
        const stored = vault.files.get(`${TARGET_FOLDER}/${file.filename}`);
        expect(stored).toBe(file.content);
      }
    });
  });

  describe("bootstrap() — idempotency", () => {
    it("is a no-op when all 7 files already exist at target path", async () => {
      const preExisting = BUNDLED_UIDS.map(
        (uid) => `${TARGET_FOLDER}/${uid}.md`,
      );
      const vault = makeVault(preExisting);
      const bootstrapper = new UiOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(7);
      expect(vault.createdPaths).toHaveLength(0);
    });

    it("second bootstrap call after first is a no-op (re-run safety)", async () => {
      const vault = makeVault();
      const bootstrapper = new UiOntologyBootstrapper(vault);

      const first = await bootstrapper.bootstrap();
      expect(first.created).toHaveLength(7);

      const second = await bootstrapper.bootstrap();
      expect(second.created).toHaveLength(0);
      expect(second.skipped).toHaveLength(7);
      expect(vault.files.size).toBe(7);
    });

    it("is a no-op when the 7 UUIDs already exist in a legacy custom folder (e.g. starter-kit `03 Knowledge/ui/`)", async () => {
      // Regression for #2943 follow-up: user with manually-copied starter-kit
      // files at `03 Knowledge/ui/<uid>.md` must NOT receive a duplicate copy
      // at `_exocortex-ui-ontology/` on plugin upgrade — duplicate
      // `exo__Asset_uid` breaks `RelationColumnSetRepository`.
      const legacyPaths = BUNDLED_UIDS.map(
        (uid) => `03 Knowledge/ui/${uid}.md`,
      );
      const vault = makeVault(legacyPaths);

      // UID-scan must fire first (before the default-target path check)
      expect(vault.hasAssetWithUid(BUNDLED_UIDS[0])).toBe(true);

      const bootstrapper = new UiOntologyBootstrapper(vault);
      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(7);
      expect(vault.createdPaths).toHaveLength(0);
      expect(vault.ensuredFolders).toHaveLength(0);
      // Nothing written at the default target — no duplicates.
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`${TARGET_FOLDER}/${uid}.md`)).toBe(false);
      }
    });

    it("creates only the missing subset when vault has partial install", async () => {
      const preExisting = [
        `${TARGET_FOLDER}/3ee15e1b-3725-4497-9946-df0b67b63f29.md`,
        `${TARGET_FOLDER}/97fc9862-c886-4d86-9a60-e0cf9d778575.md`,
      ];
      const vault = makeVault(preExisting);
      const bootstrapper = new UiOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.skipped).toHaveLength(2);
      expect(result.created).toHaveLength(5);
      expect(vault.files.size).toBe(7);
    });
  });

  describe("bootstrap() — folder handling", () => {
    it("ensures the target folder before any file write", async () => {
      const vault = makeVault();
      const calls: string[] = [];
      vault.ensureFolder = async (path) => {
        calls.push(`folder:${path}`);
      };
      vault.createFile = async (path, _content) => {
        calls.push(`file:${path}`);
        vault.files.set(path, _content);
      };
      const bootstrapper = new UiOntologyBootstrapper(vault);

      await bootstrapper.bootstrap();

      expect(calls[0]).toBe(`folder:${TARGET_FOLDER}`);
      expect(calls.slice(1).every((c) => c.startsWith("file:"))).toBe(true);
    });

    it("does not ensure folder when nothing needs to be created", async () => {
      const preExisting = BUNDLED_UIDS.map(
        (uid) => `${TARGET_FOLDER}/${uid}.md`,
      );
      const vault = makeVault(preExisting);
      const bootstrapper = new UiOntologyBootstrapper(vault);

      await bootstrapper.bootstrap();

      expect(vault.ensuredFolders).toHaveLength(0);
    });
  });

  describe("bootstrap() — resilience", () => {
    it("continues installing remaining files if one write throws", async () => {
      const vault = makeVault();
      let attempts = 0;
      vault.createFile = async (path, content) => {
        attempts++;
        if (attempts === 2) throw new Error("disk full simulation");
        vault.files.set(path, content);
        vault.createdPaths.push(path);
      };
      const bootstrapper = new UiOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(6);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error.message).toBe("disk full simulation");
    });
  });

  describe("bootstrap() — configurable target folder", () => {
    it("installs into a custom folder when one is provided", async () => {
      const vault = makeVault();
      const bootstrapper = new UiOntologyBootstrapper(vault, {
        targetFolder: "ontologies/ui",
      });

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(7);
      expect(vault.ensuredFolders).toContain("ontologies/ui");
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`ontologies/ui/${uid}.md`)).toBe(true);
      }
    });
  });
});

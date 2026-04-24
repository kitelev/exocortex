import {
  EXO_LAYOUT_ONTOLOGY_FILES,
  ExoLayoutOntologyBootstrapper,
  type ExoLayoutOntologyBootstrapperVault,
} from "../../../../src/infrastructure/ontology/ExoLayoutOntologyBootstrapper";

interface FakeVault extends ExoLayoutOntologyBootstrapperVault {
  files: Map<string, string>;
  folders: Set<string>;
  createdPaths: string[];
  ensuredFolders: string[];
  existingUids: Set<string>;
}

const UUID_BASENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

const TARGET_FOLDER = "_exocortex-exo-layout-ontology";

// 18 UIDs from starter-kit PR #87 (commit 84101d3, 2026-04-24).
// 4 classes + 14 properties.
const BUNDLED_UIDS = [
  // 4 classes
  "08d00289-a5c8-4df1-8885-40a00a014004", // exo__Layout
  "6bca6f8d-2a2b-4f38-8e20-97727499009e", // exo__LayoutBlock
  "2e868956-d81e-43fd-9817-1addde9cb311", // exo__BacklinksTableBlock
  "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe", // exo__PropertiesBlock
  // 4 Layout_* properties
  "c062eb14-e21a-44f9-a490-6f9773e0a93d", // targetClass
  "f39f69bb-24e4-4f21-aa4c-5fe6a69dd4e6", // priority
  "d1d19227-937b-4761-89a6-e2f665716262", // blocks
  "11db753b-df28-46e1-91eb-acea7ca2f9c8", // coexistsWithDefault
  // 3 LayoutBlock_* properties
  "a3df1733-a66d-40ab-8a71-acca4886609a", // title
  "5f48b45b-fdc7-44ef-8846-f3ffd70665fc", // type
  "5b52a2aa-f5ea-48bb-a1c5-728d59bb805f", // collapsed
  // 7 BacklinksTableBlock_* properties
  "07bc2f29-abde-43ed-9b7a-72b67114cf54", // rowClass
  "76bb0bde-d692-41c4-88ab-7637bf0c7e54", // referencingProperty
  "42c32853-c8e4-462d-b927-6d16d962aa3e", // columns
  "05a5f768-298f-4561-aad5-31c8c326eece", // sortBy
  "cb70ba11-6e07-4fbb-a38f-afd0c6ecff02", // sortOrder
  "498a804d-e925-4cec-a392-1b1a6d4bd3d1", // limit
  "3ef3ddca-560e-4b6c-9e1f-deb8a28f9438", // showArchived
] as const;

const EXO_ROOT_UID = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";

describe("ExoLayoutOntologyBootstrapper", () => {
  describe("EXO_LAYOUT_ONTOLOGY_FILES static manifest", () => {
    it("bundles exactly 18 ontology files (4 classes + 14 properties)", () => {
      expect(EXO_LAYOUT_ONTOLOGY_FILES).toHaveLength(18);
    });

    it("covers all 18 canonical UUIDs", () => {
      const uids = EXO_LAYOUT_ONTOLOGY_FILES.map((f) => f.uid).sort();
      expect(uids).toEqual([...BUNDLED_UIDS].sort());
    });

    it("each file has a UUID basename and a non-empty markdown body", () => {
      for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
        expect(file.uid).toMatch(UUID_BASENAME_RE);
        expect(file.filename).toBe(`${file.uid}.md`);
        expect(file.content.length).toBeGreaterThan(0);
        expect(file.content).toContain(`exo__Asset_uid: ${file.uid}`);
      }
    });

    it("each file references the !exo ontology root via isDefinedBy", () => {
      for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
        expect(file.content).toContain(
          `exo__Asset_isDefinedBy: "[[${EXO_ROOT_UID}]]"`,
        );
      }
    });

    it("class files use exo__Class (8619c4fc) instance", () => {
      const classUids = new Set([
        "08d00289-a5c8-4df1-8885-40a00a014004",
        "6bca6f8d-2a2b-4f38-8e20-97727499009e",
        "2e868956-d81e-43fd-9817-1addde9cb311",
        "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe",
      ]);
      for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
        if (!classUids.has(file.uid)) continue;
        expect(file.content).toContain(
          "exo__Instance_class:\n  - \"[[8619c4fc-64f1-4869-b17e-e34186cacca9]]\"",
        );
      }
    });

    it("subclass files carry rdfs__subClassOf to exo__LayoutBlock", () => {
      const subclassUids = new Set([
        "2e868956-d81e-43fd-9817-1addde9cb311", // BacklinksTableBlock
        "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe", // PropertiesBlock
      ]);
      for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
        if (!subclassUids.has(file.uid)) continue;
        expect(file.content).toContain(
          "rdfs__subClassOf: \"[[6bca6f8d-2a2b-4f38-8e20-97727499009e|exo__LayoutBlock]]\"",
        );
      }
    });
  });

  describe("bootstrap() — empty vault", () => {
    it("creates target folder + all 18 files when vault is empty", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(18);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(vault.ensuredFolders).toContain(TARGET_FOLDER);
      expect(vault.createdPaths).toHaveLength(18);
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`${TARGET_FOLDER}/${uid}.md`)).toBe(true);
      }
    });

    it("written file content matches the bundled manifest verbatim", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      await bootstrapper.bootstrap();

      for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
        const stored = vault.files.get(`${TARGET_FOLDER}/${file.filename}`);
        expect(stored).toBe(file.content);
      }
    });
  });

  describe("bootstrap() — idempotency", () => {
    it("is a no-op when all 18 files already exist at target path", async () => {
      const preExisting = BUNDLED_UIDS.map(
        (uid) => `${TARGET_FOLDER}/${uid}.md`,
      );
      const vault = makeVault(preExisting);
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(18);
      expect(vault.createdPaths).toHaveLength(0);
    });

    it("second bootstrap call after first is a no-op (re-run safety)", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const first = await bootstrapper.bootstrap();
      expect(first.created).toHaveLength(18);

      const second = await bootstrapper.bootstrap();
      expect(second.created).toHaveLength(0);
      expect(second.skipped).toHaveLength(18);
      expect(vault.files.size).toBe(18);
    });

    it("is a no-op when the 18 UUIDs already exist in a legacy custom folder (e.g. starter-kit `exo/`)", async () => {
      // Regression for RFC be70f741 Task 2 v15.121.0 defect (advisor warning=requirement):
      // starter-kit install convention is `exo/<uid>.md`. UID-aware scan must
      // detect these to avoid creating duplicate exo__Asset_uid in the default
      // hidden folder.
      const legacyPaths = BUNDLED_UIDS.map((uid) => `exo/${uid}.md`);
      const vault = makeVault(legacyPaths);

      expect(vault.hasAssetWithUid(BUNDLED_UIDS[0])).toBe(true);

      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);
      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(18);
      expect(vault.createdPaths).toHaveLength(0);
      expect(vault.ensuredFolders).toHaveLength(0);
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`${TARGET_FOLDER}/${uid}.md`)).toBe(false);
      }
    });

    it("creates only the missing subset when vault has partial install", async () => {
      const preExisting = [
        `${TARGET_FOLDER}/08d00289-a5c8-4df1-8885-40a00a014004.md`, // Layout class
        `${TARGET_FOLDER}/6bca6f8d-2a2b-4f38-8e20-97727499009e.md`, // LayoutBlock class
        `${TARGET_FOLDER}/c062eb14-e21a-44f9-a490-6f9773e0a93d.md`, // Layout_targetClass
      ];
      const vault = makeVault(preExisting);
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.skipped).toHaveLength(3);
      expect(result.created).toHaveLength(15);
      expect(vault.files.size).toBe(18);
    });

    it("is a no-op when UIDs exist in a non-default folder without matching path", async () => {
      // User has manually copied exo-layout ontology to `03 Knowledge/exo/`.
      // UID scan finds them, path check at the default folder doesn't — UID
      // check must win and all 18 are skipped.
      const customPaths = BUNDLED_UIDS.map(
        (uid) => `03 Knowledge/exo/${uid}.md`,
      );
      const vault = makeVault(customPaths);
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(18);
    });
  });

  describe("bootstrap() — folder handling", () => {
    it("ensures the target folder before any file write", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const order: string[] = [];
      const origEnsure = vault.ensureFolder;
      vault.ensureFolder = async (path: string) => {
        order.push(`folder:${path}`);
        await origEnsure.call(vault, path);
      };
      const origCreate = vault.createFile;
      vault.createFile = async (path: string, content: string) => {
        order.push(`file:${path}`);
        await origCreate.call(vault, path, content);
      };

      await bootstrapper.bootstrap();

      expect(order[0]).toBe(`folder:${TARGET_FOLDER}`);
      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toMatch(/^file:/);
      }
    });

    it("does NOT call ensureFolder when all files are skipped (idempotent no-op)", async () => {
      const preExisting = BUNDLED_UIDS.map(
        (uid) => `exo/${uid}.md`,
      );
      const vault = makeVault(preExisting);
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      await bootstrapper.bootstrap();

      expect(vault.ensuredFolders).toHaveLength(0);
    });

    it("accepts a custom targetFolder option", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault, {
        targetFolder: "custom/exo-layout",
      });

      await bootstrapper.bootstrap();

      expect(vault.ensuredFolders).toContain("custom/exo-layout");
      for (const uid of BUNDLED_UIDS) {
        expect(vault.files.has(`custom/exo-layout/${uid}.md`)).toBe(true);
      }
    });
  });

  describe("bootstrap() — error isolation", () => {
    it("continues installing remaining files when a single create fails", async () => {
      const vault = makeVault();
      const bootstrapper = new ExoLayoutOntologyBootstrapper(vault);

      const failingUid = BUNDLED_UIDS[0];
      const failingPath = `${TARGET_FOLDER}/${failingUid}.md`;
      const origCreate = vault.createFile;
      vault.createFile = async (path: string, content: string) => {
        if (path === failingPath) throw new Error("simulated write failure");
        await origCreate.call(vault, path, content);
      };

      const result = await bootstrapper.bootstrap();

      expect(result.created).toHaveLength(17);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe(failingPath);
      expect(result.errors[0].error.message).toBe("simulated write failure");
    });
  });
});

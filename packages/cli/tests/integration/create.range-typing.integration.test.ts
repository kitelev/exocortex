/**
 * Ticket 2227d660 — `create --property k=v` typed a YAML scalar by its SHAPE
 * (`MetadataHelpers.buildFileContent` → `serializeYamlScalar`: a leading `-` ⇒
 * quoted), not by the property's DECLARED `exo__Property_range`. The bot
 * wrappers pin `create --class ems__Reminder --property
 * ems__Reminder_chatId=<chat id>`; a GROUP chat id is negative, so every new
 * group reminder landed as an `xsd:string` literal under the `xsd:integer`
 * range (ticket d72aba19 G2) — an `sh:datatype` violation on the first new
 * asset. Measured 2026-09-19 on a copy of vault-my (CLI 16.241.5).
 *
 * The fix hands the ranges collected by `PropertyNameValidator` (the one-pass
 * TBox scan `create` already runs for the key check) to
 * `GenericAssetCreationService` as `declaredRanges`.
 *
 * Drives the REAL `createCommand()` against a temp fixture vault with a UID-canon
 * TBox (metaclass files, a class def, datatype-property defs with ranges), reads
 * the written asset back and — W4 — validates it with the SAME SHACL-lite
 * pipeline `validate schema --shapes-mode` runs (`runShapesValidation`), so the
 * end-to-end claim "a negative chat id written by `create` CONFORMS" is judged by
 * the validator, not by the emitted characters.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * with `declaredRanges` no longer handed to the service (pre-ticket state) W1,
 * W2 and W4 go RED (W4: one `sh:datatype` violation on the created node); W3
 * (no TBox mounted → shape rule) stays GREEN in both states.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import * as yaml from "js-yaml";

const { createCommand } = await import("../../src/commands/create.js");
const { runShapesValidation } =
  await import("../../src/commands/validate-schema.js");
const { NoteToRDFConverter } = await import("@kitelev/exocortex-core");
const { FileSystemVaultAdapter } =
  await import("../../src/adapters/FileSystemVaultAdapter.js");

// requirements-trace binds ONLY on a literal `@req:<uuid>` token:
// @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105
const REQ = "21ceea14-50dd-4cf8-bd3b-5a50b7c97105";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** The metaclass files (`exo__Property`, `exo__DatatypeProperty ⊑ exo__Property`) the shape loaders walk from. */
const METACLASS_FIXTURES = path.resolve(
  __dirname,
  "../fixtures/shacl-integration/tbox",
);

const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296"; // exo__DatatypeProperty
const CLASS_UID = "40a0741c-0000-4000-8000-000000000001"; // ems__Reminder (fixture)
const TBOX_DIR = "assetspaces/kitelev/exoas-public/ems";
const NEG_CHAT_ID = "-1001234567890";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "body", "");
  return lines.join("\n");
}

function writeDef(
  vault: string,
  uid: string,
  label: string,
  range: string,
): void {
  fs.writeFileSync(
    path.join(vault, TBOX_DIR, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Instance_class: [`"[[${DATATYPE_PROPERTY_UID}]]"`],
      exo__Asset_label: label,
      exo__Property_domain: `"[[${CLASS_UID}]]"`,
      exo__Property_range: range,
      exo__Property_severity: "sh:Violation",
    }),
  );
}

/** UID-canon TBox: metaclasses (copied from the SHACL fixture), the class, its datatype props. */
function buildTbox(vault: string): void {
  const exoDir = path.join(vault, "assetspaces/kitelev/exoas-exo/exo");
  fs.mkdirSync(exoDir, { recursive: true });
  for (const f of fs.readdirSync(METACLASS_FIXTURES)) {
    fs.copyFileSync(path.join(METACLASS_FIXTURES, f), path.join(exoDir, f));
  }
  fs.mkdirSync(path.join(vault, TBOX_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(vault, TBOX_DIR, `${CLASS_UID}.md`),
    md({
      exo__Asset_uid: CLASS_UID,
      exo__Instance_class: ['"[[exo__Class]]"'],
      exo__Asset_label: "ems__Reminder",
      aliases: ["ems__Reminder"],
    }),
  );
  writeDef(
    vault,
    "39197b8c-0000-4000-8000-000000000011",
    "ems__Reminder_chatId",
    "xsd:integer",
  );
  writeDef(
    vault,
    "f11bd200-0000-4000-8000-000000000012",
    "ems__Reminder_text",
    "xsd:string",
  );
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("no frontmatter in written file");
  return (yaml.load(m[1], { schema: yaml.YAML11_SCHEMA }) ?? {}) as Record<
    string,
    unknown
  >;
}

function lineFor(content: string, key: string): string | undefined {
  return content.split("\n").find((l) => l.startsWith(`${key}:`));
}

/** The asset `create` wrote: the only file carrying the probe label. */
function findCreated(vault: string, label: string): string {
  const stack = [vault];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (
        entry.name.endsWith(".md") &&
        fs.readFileSync(full, "utf-8").includes(`exo__Asset_label: ${label}`)
      ) {
        return full;
      }
    }
  }
  throw new Error(`created asset with label ${label} not found under ${vault}`);
}

describe(`ticket 2227d660: create types a scalar by the declared exo__Property_range @req:${REQ}`, () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-2227d660-create-"));
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function create(
    label: string,
    properties: string[],
  ): Promise<{
    exit: number[];
    file: string;
    content: string;
    parsed: Record<string, unknown>;
  }> {
    const cmd = createCommand();
    const args = ["--vault", vault, "--class", CLASS_UID, "--label", label];
    for (const p of properties) args.push("--property", p);
    await cmd.parseAsync(args, { from: "user" });
    const file = findCreated(vault, label);
    const content = fs.readFileSync(file, "utf-8");
    return {
      exit: [...exitCodes],
      file,
      content,
      parsed: parseFrontmatter(content),
    };
  }

  it(`W1 a canonical NEGATIVE chat id under the mounted xsd:integer def is written BARE and reads back as that number @req:${REQ}`, async () => {
    buildTbox(vault);
    const out = await create("W1 neg", [`ems__Reminder_chatId=${NEG_CHAT_ID}`]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_chatId")).toBe(
      `ems__Reminder_chatId: ${NEG_CHAT_ID}`,
    );
    expect(out.parsed.ems__Reminder_chatId).toBe(-1001234567890);
  });

  it(`W2 a numeric value under the mounted xsd:string def is QUOTED and reads back as a string; a positive id under xsd:integer stays bare @req:${REQ}`, async () => {
    buildTbox(vault);
    const out = await create("W2 str", [
      "ems__Reminder_text=42",
      "ems__Reminder_chatId=123456789",
    ]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_text")).toBe(
      'ems__Reminder_text: "42"',
    );
    expect(out.parsed.ems__Reminder_text).toBe("42");
    expect(lineFor(out.content, "ems__Reminder_chatId")).toBe(
      "ems__Reminder_chatId: 123456789",
    );
    expect(out.parsed.ems__Reminder_chatId).toBe(123456789);
  });

  it(`W3 control — NO property TBox mounted: the pre-ticket shape rule is byte-identical (negative quoted, number bare) @req:${REQ}`, async () => {
    const out = await create("W3 bare", [
      `ems__Reminder_chatId=${NEG_CHAT_ID}`,
      "ems__Reminder_text=42",
    ]);
    expect(out.exit).not.toContain(1);
    expect(lineFor(out.content, "ems__Reminder_chatId")).toBe(
      `ems__Reminder_chatId: "${NEG_CHAT_ID}"`,
    );
    expect(out.parsed.ems__Reminder_chatId).toBe(NEG_CHAT_ID);
    expect(lineFor(out.content, "ems__Reminder_text")).toBe(
      "ems__Reminder_text: 42",
    );
  });

  it(`W4 end-to-end — the asset \`create\` wrote CONFORMS under \`validate schema --shapes-mode\` (no sh:datatype violation on chatId or text) @req:${REQ}`, async () => {
    buildTbox(vault);
    const out = await create("W4 e2e", [
      `ems__Reminder_chatId=${NEG_CHAT_ID}`,
      "ems__Reminder_text=42",
    ]);
    expect(out.exit).not.toContain(1);

    const adapter = new FileSystemVaultAdapter(vault);
    const converter = new NoteToRDFConverter(adapter);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await converter.convertVault()) as any[];
    const report = await runShapesValidation(vault, triples);

    const created = path.basename(out.file);
    const own = report.violations.filter((v) =>
      v.focusNode.endsWith(`/${created}`),
    );
    // Canary: the shapes ARE loaded and DO reach this node — the datatype
    // constraint is what a violation would come from, so prove the shape
    // exists by asserting a deliberately wrong write is judged (a second asset
    // with the value pre-quoted by the caller passes `serializeYamlScalar`
    // through verbatim and lands as an xsd:string literal).
    const control = await create("W4 control", [
      `ems__Reminder_chatId="${NEG_CHAT_ID}"`,
    ]);
    const triples2 = (await converter.convertVault()) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const report2 = await runShapesValidation(vault, triples2);
    const controlOwn = report2.violations.filter((v) =>
      v.focusNode.endsWith(`/${path.basename(control.file)}`),
    );
    expect(
      controlOwn.some((v) => v.message.includes("sh:datatype violation")),
    ).toBe(true);

    expect(
      own.filter((v) => v.message.includes("sh:datatype violation")),
    ).toEqual([]);
  });
});

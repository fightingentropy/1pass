// Command-line access to the vault: list identities, attach a file to one, or
// download an attachment. It reuses the browser's crypto and API modules, so
// files are encrypted client-side exactly as the app does. The master password
// comes from a hidden prompt (or the first line of stdin when piped) and is
// only used in this process to derive keys.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  isVaultEncryptedPayload,
  type VaultAttachment,
  type VaultIdentityItem,
  type VaultPayload,
} from "../functions/api/vault/schema";
import {
  decryptVaultPayload,
  encryptVaultPayload,
  restoreVaultSession,
  type VaultSession,
} from "../src/vaultCrypto";
import {
  configureApiBase,
  deleteAttachmentRemote,
  downloadAttachmentChunks,
  isConflictError,
  isUnauthorizedError,
  loadVaultRecord,
  readVaultMeta,
  saveVaultRecord,
  uploadAttachmentBytes,
} from "../src/vault/api";
import {
  ATTACHMENT_MAX_BYTES,
  createId,
  formatBytes,
  normalizeVault,
} from "../src/vault/types";

const DEFAULT_URL = "https://1pass.erlin.org";

const USAGE = `1Pass Vault command line

Usage:
  bun run cli list
  bun run cli attach FILE [--identity NAME|ID] [--name NAME] [--replace] [--no-verify]
  bun run cli download NAME|ID [--identity NAME|ID] [--out PATH] [--force]

Options:
  --url URL        Vault address (default: $VAULT_URL or ${DEFAULT_URL})
  --identity       Identity by full name or id; asked for when omitted
  --name NAME      Attachment name (default: the file name)
  --replace        Replace an attachment of the same name on that identity
  --no-verify      Skip downloading the attachment again after saving
  --out PATH       Where to write a download (default: the attachment name)
  --force          Overwrite an existing download target

The master password is read from a hidden prompt, or from the first line of
stdin when stdin is not a terminal. It never leaves this process.
`;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
};

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

type Options = {
  positional: string[];
  values: Map<string, string>;
  flags: Set<string>;
};

function parseArguments(argv: string[]): Options {
  const valueOptions = new Set(["--url", "--identity", "--name", "--out"]);
  const flagOptions = new Set(["--replace", "--no-verify", "--force", "--help", "-h"]);
  const options: Options = { positional: [], values: new Map(), flags: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      options.positional.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith("-")) {
      options.positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const key = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    if (flagOptions.has(key)) {
      if (inline !== undefined) throw new CliError(`${key} does not take a value.`, 2);
      options.flags.add(key);
      continue;
    }
    if (!valueOptions.has(key)) throw new CliError(`Unknown option ${key}.`, 2);
    if (options.values.has(key)) throw new CliError(`Repeated option ${key}.`, 2);
    const value = inline ?? argv[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) {
      throw new CliError(`${key} requires a value.`, 2);
    }
    if (inline === undefined) index += 1;
    options.values.set(key, value);
  }
  return options;
}

// One reader for the whole run, so lines that arrive together are kept in
// order for later prompts instead of being dropped.
let reader: Interface | null = null;
let readerClosed = false;
const bufferedLines: string[] = [];
const lineWaiters: ((line: string) => void)[] = [];

function readLine(): Promise<string> {
  if (!reader) {
    reader = createInterface({ input: process.stdin, terminal: false });
    reader.on("line", (line) => {
      const waiter = lineWaiters.shift();
      if (waiter) waiter(line);
      else bufferedLines.push(line);
    });
    reader.on("close", () => {
      readerClosed = true;
      while (lineWaiters.length > 0) lineWaiters.shift()!("");
    });
  }
  const buffered = bufferedLines.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  if (readerClosed) return Promise.resolve("");
  return new Promise((resolveLine) => lineWaiters.push(resolveLine));
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const line = await readLine();
    if (!line) throw new CliError("No master password was provided on stdin.");
    return line;
  }
  const setEcho = (enabled: boolean) => {
    spawnSync("stty", [enabled ? "echo" : "-echo"], { stdio: "inherit" });
  };
  const onInterrupt = () => {
    setEcho(true);
    process.stderr.write("\n");
    process.exit(130);
  };
  setEcho(false);
  process.once("SIGINT", onInterrupt);
  process.stderr.write("Master password: ");
  try {
    const line = await readLine();
    if (!line) throw new CliError("No master password was entered.");
    return line;
  } finally {
    process.off("SIGINT", onInterrupt);
    setEcho(true);
    process.stderr.write("\n");
  }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type Unlocked = { session: VaultSession; vault: VaultPayload; revision: number };

// Mirrors the browser unlock for an up-to-date vault. Upgrades, bootstrap
// adoption and migration recovery stay in the browser, which can confirm them.
async function unlock(url: string): Promise<Unlocked> {
  configureApiBase(url);
  let meta;
  try {
    meta = await readVaultMeta();
  } catch (error) {
    throw new CliError(`Cannot reach the vault at ${url}: ${describe(error)}`);
  }
  if (!meta.exists) throw new CliError(`No vault exists at ${url}.`);
  if (meta.requiresBootstrap || meta.version !== 3 || !meta.kdf) {
    throw new CliError(
      "This vault needs a one-time security upgrade. Unlock it in the browser first, then retry.",
    );
  }
  const password = await readPassword();
  process.stderr.write("Deriving keys…\n");
  const session = await restoreVaultSession(password, { version: 3, kdf: meta.kdf });
  let record: { payload: unknown; revision: number };
  try {
    record = await loadVaultRecord(session.authToken);
  } catch (error) {
    if (isUnauthorizedError(error)) throw new CliError("Incorrect password.");
    throw error;
  }
  if (!isVaultEncryptedPayload(record.payload)) throw new CliError("Vault data is corrupted.");
  let decrypted: unknown;
  try {
    decrypted = await decryptVaultPayload(record.payload, session);
  } catch {
    throw new CliError("Incorrect password.");
  }
  if (decrypted && typeof decrypted === "object" && "pendingMigration" in decrypted) {
    throw new CliError(
      "A security upgrade is in progress. Unlock the vault in the browser to finish it, then retry.",
    );
  }
  return { session, vault: normalizeVault(decrypted), revision: record.revision };
}

function fullName(identity: VaultIdentityItem) {
  return `${identity.firstName} ${identity.lastName}`.trim();
}

function describeIdentity(identity: VaultIdentityItem) {
  const count = identity.attachments.length;
  return `${fullName(identity)} (${count} file${count === 1 ? "" : "s"})`;
}

async function chooseIdentity(vault: VaultPayload, selector: string | undefined) {
  if (vault.identities.length === 0) {
    throw new CliError("The vault has no identities yet. Create one in the browser first.");
  }
  if (selector !== undefined) {
    const wanted = selector.trim();
    const byId = vault.identities.filter((identity) => identity.id === wanted);
    const matches =
      byId.length > 0
        ? byId
        : vault.identities.filter(
            (identity) => fullName(identity).toLowerCase() === wanted.toLowerCase(),
          );
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new CliError(`Several identities are named "${wanted}". Use an id from 'list' instead.`);
    }
    throw new CliError(`No identity matches "${wanted}". Run 'list' to see them.`);
  }
  if (vault.identities.length === 1) return vault.identities[0]!;
  const lines = vault.identities.map(
    (identity, index) => `  ${index + 1}. ${describeIdentity(identity)}`,
  );
  if (!process.stdin.isTTY) {
    throw new CliError(`Choose an identity with --identity:\n${lines.join("\n")}`);
  }
  process.stderr.write(
    `Identities:\n${lines.join("\n")}\nAttach to which identity? [1-${vault.identities.length}] `,
  );
  const choice = Number((await readLine()).trim());
  if (!Number.isInteger(choice) || choice < 1 || choice > vault.identities.length) {
    throw new CliError("No identity chosen.");
  }
  return vault.identities[choice - 1]!;
}

function concatenate(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

async function list(url: string, options: Options) {
  if (options.positional.length > 0) throw new CliError("list takes no arguments.", 2);
  const { vault, revision } = await unlock(url);
  const identities = vault.identities.length;
  console.log(
    `Vault at ${url} (revision ${revision}): ${identities} identit${identities === 1 ? "y" : "ies"}, ${vault.apiKeys.length} API key${vault.apiKeys.length === 1 ? "" : "s"}`,
  );
  for (const identity of vault.identities) {
    console.log(`\n${fullName(identity)}  ${identity.id}`);
    if (identity.attachments.length === 0) console.log("  no files");
    for (const attachment of identity.attachments) {
      const day = new Date(attachment.createdAt).toISOString().slice(0, 10);
      console.log(`  ${attachment.name}  ${formatBytes(attachment.size)}  ${day}  ${attachment.id}`);
    }
  }
}

async function attach(url: string, options: Options) {
  if (options.positional.length !== 1) throw new CliError("attach takes exactly one file.", 2);
  const source = resolve(options.positional[0]!);
  if (!existsSync(source)) throw new CliError(`File not found: ${source}`);
  const bytes = new Uint8Array(readFileSync(source));
  if (bytes.length === 0) throw new CliError("The file is empty.");
  if (bytes.length > ATTACHMENT_MAX_BYTES) throw new CliError("Files are limited to 25 MB.");
  const name = (options.values.get("--name") ?? basename(source)).trim();
  if (!name) throw new CliError("The attachment name is empty.", 2);

  const { session, vault, revision } = await unlock(url);
  const identity = await chooseIdentity(vault, options.values.get("--identity"));
  const replaced = identity.attachments.filter((attachment) => attachment.name === name);
  if (replaced.length > 0 && !options.flags.has("--replace")) {
    throw new CliError(
      `${fullName(identity)} already has an attachment named "${name}". Use --replace to replace it, or --name to choose another name.`,
    );
  }

  const fileId = createId();
  const manifest = await uploadAttachmentBytes(fileId, bytes, session, (percent) => {
    process.stderr.write(`\rEncrypting and uploading… ${percent}%`);
  });
  process.stderr.write("\n");
  const attachment: VaultAttachment = {
    id: fileId,
    name,
    mimeType: MIME_TYPES[extname(source).toLowerCase()] ?? "application/octet-stream",
    size: bytes.length,
    ...manifest,
    thumb: "",
    createdAt: Date.now(),
  };
  const now = Date.now();
  const next: VaultPayload = {
    ...vault,
    identities: vault.identities.map((item) =>
      item.id === identity.id
        ? {
            ...item,
            attachments: [
              ...item.attachments.filter((existing) => !replaced.includes(existing)),
              attachment,
            ],
            updatedAt: now,
          }
        : item,
    ),
  };

  let savedRevision: number;
  try {
    const payload = await encryptVaultPayload(next, session);
    savedRevision = await saveVaultRecord(payload, session.authToken, revision);
  } catch (error) {
    // The upload is committed but unreferenced; remove it like the app does.
    await deleteAttachmentRemote(fileId, session.authToken).catch(() => {});
    if (isConflictError(error)) {
      throw new CliError("The vault changed elsewhere while saving. Nothing was attached; retry.");
    }
    throw error;
  }
  for (const previous of replaced) {
    try {
      await deleteAttachmentRemote(previous.id, session.authToken);
    } catch (error) {
      process.stderr.write(
        `warning: the previous "${name}" was replaced, but its encrypted data could not be removed: ${describe(error)}\n`,
      );
    }
  }

  const verify = !options.flags.has("--no-verify");
  if (verify) {
    process.stderr.write("Verifying…\n");
    const copy = concatenate(await downloadAttachmentChunks(attachment, session));
    if (!sameBytes(copy, bytes)) {
      throw new CliError(
        `"${name}" was saved to the vault, but the downloaded copy does not match the file.`,
      );
    }
  }
  console.log(
    `Attached ${name} (${formatBytes(bytes.length)}) to ${fullName(identity)}${replaced.length > 0 ? ", replacing the previous copy" : ""}. Vault revision ${savedRevision}.${verify ? " Verified: the downloaded copy matches." : ""}`,
  );
}

async function download(url: string, options: Options) {
  if (options.positional.length !== 1) {
    throw new CliError("download takes exactly one attachment name or id.", 2);
  }
  const selector = options.positional[0]!;
  const { session, vault } = await unlock(url);
  const scope = options.values.has("--identity")
    ? [await chooseIdentity(vault, options.values.get("--identity"))]
    : vault.identities;
  const matches = scope.flatMap((identity) =>
    identity.attachments
      .filter((attachment) => attachment.id === selector || attachment.name === selector)
      .map((attachment) => ({ identity, attachment })),
  );
  if (matches.length === 0) throw new CliError(`No attachment matches "${selector}".`);
  if (matches.length > 1) {
    const lines = matches.map(
      (match) => `  ${match.attachment.id}  ${fullName(match.identity)} / ${match.attachment.name}`,
    );
    throw new CliError(
      `Several attachments match "${selector}":\n${lines.join("\n")}\nUse the id, or --identity to narrow it down.`,
    );
  }
  const { identity, attachment } = matches[0]!;
  const target = resolve(options.values.get("--out") ?? basename(attachment.name));
  if (existsSync(target) && !options.flags.has("--force")) {
    throw new CliError(`${target} already exists. Use --force to overwrite it.`);
  }
  const bytes = concatenate(await downloadAttachmentChunks(attachment, session));
  writeFileSync(target, bytes, { mode: 0o600 });
  console.log(
    `Downloaded ${attachment.name} (${formatBytes(bytes.length)}) from ${fullName(identity)} to ${target}.`,
  );
}

async function main(argv: string[]) {
  const options = parseArguments(argv);
  const [command, ...rest] = options.positional;
  if (!command || options.flags.has("--help") || options.flags.has("-h")) {
    console.log(USAGE);
    return;
  }
  options.positional = rest;
  const url = options.values.get("--url") ?? process.env.VAULT_URL ?? DEFAULT_URL;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(`Invalid vault URL: ${url}`, 2);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new CliError("The vault URL must use https (http is allowed for localhost only).", 2);
  }
  switch (command) {
    case "list":
      return list(url, options);
    case "attach":
      return attach(url, options);
    case "download":
      return download(url, options);
    default:
      throw new CliError(`Unknown command "${command}". Run with --help.`, 2);
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`error: ${describe(error)}\n`);
    process.exit(error instanceof CliError ? error.exitCode : 1);
  },
);

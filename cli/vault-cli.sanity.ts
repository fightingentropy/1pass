// Sanity check — runs the CLI against a local Pages dev server with its own
// throwaway vault and prints PASS/FAIL per check. Run with:
//   bun run test:cli
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureApiBase, initVault, readVaultMeta } from "../src/vault/api";
import { createVaultSession, encryptVaultPayload } from "../src/vaultCrypto";
import { normalizeIdentityItem } from "../src/vault/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const cliScript = path.join(root, "cli", "vault-cli.ts");
const PORT = 8797;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const BOOTSTRAP_SECRET = "cli-sanity-bootstrap";

function randomHex(bytes: number) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65_536)));
  }
  return bytes;
}

// Test values only: a throwaway vault in a temporary directory.
const password = randomHex(16);
const persistDir = mkdtempSync(path.join(tmpdir(), "1pass-cli-state-"));
const workDir = mkdtempSync(path.join(tmpdir(), "1pass-cli-work-"));

let allPass = true;
function check(label: string, ok: boolean, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${label}${!ok && detail ? `: ${detail.trim()}` : ""}`);
  if (!ok) allPass = false;
}

type Run = { code: number | null; stdout: string; stderr: string };

function cli(args: string[], input = password): Run {
  const target = args.includes("--url") ? [] : ["--url", URL_BASE];
  // Runs in the temporary directory, so any default output lands there.
  const result = spawnSync("bun", ["run", cliScript, ...args, ...target], {
    cwd: workDir,
    input: `${input}\n`,
    encoding: "utf8",
    env: { ...process.env, VAULT_URL: "" },
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Runs an attach in a pseudo-terminal, answering the hidden password prompt
// and the identity question only once each appears, as a person would.
function cliInTerminal(file: string, identityChoice: string): Run {
  const script = [
    "set timeout 60",
    "spawn bun run $env(SANITY_CLI) attach $env(SANITY_FILE) --url $env(SANITY_URL)",
    'expect "Master password: "',
    'send "$env(SANITY_PASSWORD)\\r"',
    'expect "which identity?"',
    'send "$env(SANITY_CHOICE)\\r"',
    "expect eof",
    "lassign [wait] pid spawnid oserror status",
    "exit $status",
  ].join("\n");
  const result = spawnSync("expect", ["-c", script], {
    cwd: workDir,
    encoding: "utf8",
    env: {
      ...process.env,
      VAULT_URL: "",
      SANITY_CLI: cliScript,
      SANITY_FILE: file,
      SANITY_URL: URL_BASE,
      SANITY_PASSWORD: password,
      SANITY_CHOICE: identityChoice,
    },
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function waitForServer(server: ChildProcess, log: () => string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`wrangler exited early:\n${log()}`);
    try {
      const response = await fetch(`${URL_BASE}/api/vault/meta`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`wrangler did not become ready:\n${log()}`);
}

async function main() {
  const migrated = spawnSync(
    wranglerBin,
    ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistDir],
    { cwd: root, encoding: "utf8" },
  );
  if (migrated.status !== 0) {
    throw new Error(`migrations failed:\n${migrated.stdout}\n${migrated.stderr}`);
  }

  let output = "";
  const server = spawn(
    wranglerBin,
    [
      "pages",
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistDir,
      "--binding",
      `BOOTSTRAP_SECRET=${BOOTSTRAP_SECRET}`,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  server.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const stopServer = () => {
    if (server.pid && server.exitCode === null) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  };

  try {
    await waitForServer(server, () => output);
    configureApiBase(URL_BASE);
    check("fresh vault has no data", (await readVaultMeta()).exists === false);

    const session = await createVaultSession(password);
    const vault = {
      identities: [
        normalizeIdentityItem({ firstName: "Test", lastName: "Person" }),
        normalizeIdentityItem({ firstName: "Second", lastName: "Person" }),
      ],
      apiKeys: [],
    };
    const revision = await initVault(
      await encryptVaultPayload(vault, session),
      session.authToken,
      BOOTSTRAP_SECRET,
    );
    check("vault initialized", revision === 0);

    const small = path.join(workDir, "small.key");
    const large = path.join(workDir, "large.bin");
    const smallContent = randomBytes(1_700);
    const largeContent = randomBytes(2_500_000);
    writeFileSync(small, smallContent);
    writeFileSync(large, largeContent);

    const listed = cli(["list"]);
    check("list succeeds", listed.code === 0, listed.stderr);
    check(
      "list shows both identities without files",
      listed.stdout.includes("Test Person") &&
        listed.stdout.includes("Second Person") &&
        listed.stdout.split("no files").length === 3,
    );
    const identityId = listed.stdout.match(/^Test Person {2}(\S+)$/m)?.[1] ?? "";
    check("list shows identity ids", identityId.length > 0);

    const attached = cli(["attach", small, "--identity", "Test Person"]);
    check("attach by name succeeds", attached.code === 0, attached.stderr);
    check(
      "attach reports success and verification",
      attached.stdout.includes("Attached small.key") && attached.stdout.includes("Verified"),
      attached.stdout,
    );

    const attachedLarge = cli(["attach", large, "--identity", identityId]);
    check("multi-chunk attach by id succeeds", attachedLarge.code === 0, attachedLarge.stderr);

    const duplicate = cli(["attach", small, "--identity", "Test Person"]);
    check(
      "duplicate name is refused without --replace",
      duplicate.code === 1 && duplicate.stderr.includes("already has"),
      duplicate.stderr,
    );

    const replacement = randomBytes(1_900);
    writeFileSync(small, replacement);
    const replaced = cli(["attach", small, "--identity", "Test Person", "--replace"]);
    check(
      "--replace swaps the attachment",
      replaced.code === 0 && replaced.stdout.includes("replacing the previous copy"),
      replaced.stderr,
    );

    let secondHasSmall = false;
    if (spawnSync("which", ["expect"]).status === 0) {
      const prompted = cliInTerminal(small, "2");
      const transcript = prompted.stdout + prompted.stderr;
      secondHasSmall =
        prompted.code === 0 &&
        transcript.includes("Attached small.key") &&
        transcript.includes("Second Person");
      check("terminal prompts choose an identity", secondHasSmall, transcript);
      check("terminal prompt does not echo the password", !transcript.includes(password));
    } else {
      console.log("  [SKIP] terminal prompt checks need `expect`");
    }

    const relisted = cli(["list"]);
    check(
      "list shows the new attachments",
      relisted.stdout.split("small.key").length === (secondHasSmall ? 3 : 2) &&
        relisted.stdout.split("large.bin").length === 2 &&
        relisted.stdout.split("no files").length === (secondHasSmall ? 1 : 2),
      relisted.stdout,
    );

    if (secondHasSmall) {
      const ambiguous = cli(["download", "small.key"]);
      check(
        "ambiguous download is refused",
        ambiguous.code === 1 && ambiguous.stderr.includes("Several attachments"),
        ambiguous.stderr,
      );
    }

    const outSmall = path.join(workDir, "out.key");
    const downloaded = cli(["download", "small.key", "--identity", "Test Person", "--out", outSmall]);
    check("download succeeds", downloaded.code === 0, downloaded.stderr);
    check(
      "downloaded bytes match the replaced file",
      Buffer.compare(readFileSync(outSmall), Buffer.from(replacement)) === 0,
    );
    check("download is private", (statSync(outSmall).mode & 0o777) === 0o600);

    const outLarge = path.join(workDir, "large.out");
    const downloadedLarge = cli(["download", "large.bin", "--out", outLarge]);
    check(
      "multi-chunk download matches",
      downloadedLarge.code === 0 &&
        Buffer.compare(readFileSync(outLarge), Buffer.from(largeContent)) === 0,
      downloadedLarge.stderr,
    );

    const existing = cli(["download", "small.key", "--identity", "Test Person", "--out", outSmall]);
    check(
      "download does not overwrite without --force",
      existing.code === 1 && existing.stderr.includes("already exists"),
    );
    const forced = cli(["download", "small.key", "--identity", "Test Person", "--out", outSmall, "--force"]);
    check("download --force overwrites", forced.code === 0, forced.stderr);

    const wrong = cli(["list"], `${password}x`);
    check(
      "wrong password is rejected",
      wrong.code === 1 && wrong.stderr.includes("Incorrect password"),
      wrong.stderr,
    );

    const nobody = cli(["attach", small, "--identity", "Nobody"]);
    check(
      "unknown identity is rejected",
      nobody.code === 1 && nobody.stderr.includes("No identity matches"),
      nobody.stderr,
    );

    const unchosen = cli(["attach", small]);
    check(
      "piped input needs --identity when several exist",
      unchosen.code === 1 &&
        unchosen.stderr.includes("--identity") &&
        unchosen.stderr.includes("Second Person"),
      unchosen.stderr,
    );

    const unreachable = cli(["list", "--url", "http://127.0.0.1:1"]);
    check(
      "unreachable vault is reported",
      unreachable.code === 1 && unreachable.stderr.includes("Cannot reach"),
      unreachable.stderr,
    );

    const bogus = cli(["bogus"]);
    check("unknown command is a usage error", bogus.code === 2);

    const insecure = cli(["list", "--url", "http://vault.example"]);
    check("plain http to a remote host is refused", insecure.code === 2, insecure.stderr);
  } finally {
    stopServer();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    rmSync(persistDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(allPass ? "\nAll CLI checks passed." : "\nSome CLI checks failed.");
    process.exit(allPass ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

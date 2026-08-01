import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(directory: string) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if ((await stat(path)).isDirectory()) await walk(path);
      else output.push(path);
    }
  }
  await walk(root);
  return output;
}

async function textBundle(root: string): Promise<string> {
  const chunks: string[] = [];
  for (const path of await files(root)) {
    if (/\.(?:html|js|css|json|txt)$/i.test(path) || path.endsWith("_headers")) {
      chunks.push(await readFile(path, "utf8"));
    }
  }
  return chunks.join("\n");
}

const vaultFiles = await files("dist");
const taxFiles = await files("tax-site/dist");
const vault = await textBundle("dist");
const tax = await textBundle("tax-site/dist");

if (vault.includes("CIS tax calculator") || vault.includes("taxFreeLumpSumPercent")) {
  throw new Error("Vault bundle still contains tax application code");
}
if (tax.includes("x-vault-auth") || tax.includes("/api/vault/") || tax.includes("VaultWorkspace")) {
  throw new Error("Tax bundle contains vault application or API code");
}
if (taxFiles.some((path) => path.endsWith("_routes.json")) || taxFiles.some((path) => path.includes("functions"))) {
  throw new Error("Tax deployment must not contain Pages Functions or API routes");
}
if (!tax.includes("connect-src 'none'")) {
  throw new Error("Tax deployment is missing its network-denying CSP");
}
if (!vaultFiles.some((path) => path.endsWith("_routes.json"))) {
  throw new Error("Vault deployment lost its API route manifest");
}

console.log("Vault and tax bundles are origin-isolated");

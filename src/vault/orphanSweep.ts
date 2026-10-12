import type { VaultPayload } from "../../functions/api/vault/schema";
import type { VaultSession } from "../vaultCrypto";
import { deleteAttachmentRemote, listRemoteAttachments } from "./api";
import { runWithConcurrency } from "./concurrency";
import { attachmentFileIds } from "./types";

// A file another tab committed but has not yet saved into the vault looks
// exactly like an orphan from here. Unreferenced files younger than this are
// left alone so a sweep can never delete an attachment that is mid-save.
export const ATTACHMENT_ORPHAN_GRACE_MS = 60 * 60 * 1000;

// Deletes are independent per file id, so a few can run at once without any
// ordering concerns; keep it modest so a large sweep does not flood the API.
const ORPHAN_DELETE_CONCURRENCY = 4;

// Attachments and their separately stored previews are both live files.
function collectReferencedAttachmentIds(vault: VaultPayload) {
  const referenced = new Set<string>();
  for (const identity of vault.identities) {
    for (const attachment of identity.attachments) {
      for (const id of attachmentFileIds(attachment)) referenced.add(id);
    }
  }
  return referenced;
}

// Removes committed server-side files that nothing in the decrypted vault
// references. The server cannot do this itself: it never learns which ids the
// encrypted payload points at, and its own GC deliberately skips live
// manifests. A crash between commit and vault save, or a delete that failed
// after the save, is what leaves these behind. Per-file failures are counted
// rather than thrown so one bad delete never stops the rest of the sweep.
export async function sweepOrphanedAttachments(
  vault: VaultPayload,
  session: VaultSession,
  now = Date.now(),
): Promise<{ removed: number; failed: number; skipped: number }> {
  const referenced = collectReferencedAttachmentIds(vault);
  const remote = await listRemoteAttachments(session.authToken);
  const cutoff = now - ATTACHMENT_ORPHAN_GRACE_MS;

  const candidates: string[] = [];
  let skipped = 0;
  for (const file of remote) {
    if (referenced.has(file.id)) continue;
    if (file.committedAt > cutoff) {
      skipped += 1;
      continue;
    }
    candidates.push(file.id);
  }

  let removed = 0;
  let failed = 0;
  await runWithConcurrency(
    candidates,
    ORPHAN_DELETE_CONCURRENCY,
    async (fileId) => {
      try {
        await deleteAttachmentRemote(fileId, session.authToken);
        removed += 1;
      } catch (error) {
        failed += 1;
        console.error(`Orphaned attachment ${fileId} cleanup failed`, error);
      }
    },
  );

  return { removed, failed, skipped };
}

import { definitionForMirror, documentClass, sharedPackId } from "../constants.js";
import { SETTINGS, getSetting } from "../settings.js";
import { getPendingDeletions, removePendingDeletion } from "./state.js";
import { withoutWatching } from "./engine.js";
import { log } from "../log.js";
import { confirm, info, t } from "../ui/notify.js";

/**
 * Deleting a document from a mirror pack never removes it from the shared library on its own.
 * The GM confirms each removal here, because a deletion is the one operation that cannot be
 * undone by syncing again.
 */

/**
 * Apply one queued deletion to the shared library.
 * @param {{pack: string, id: string}} entry
 */
export async function applyDeletion(entry) {
  const definition = definitionForMirror(entry.pack);
  if (!definition) {
    await removePendingDeletion(entry.pack, entry.id);
    return false;
  }

  const shared = game.packs.get(sharedPackId(definition.key));
  const DocumentClass = documentClass(definition.type);
  if (!shared || !DocumentClass) return false;

  try {
    await withoutWatching(() =>
      DocumentClass.deleteDocuments([entry.id], { pack: shared.collection })
    );
    log.info(`Deleted ${entry.id} from ${shared.collection}`);
  } catch (err) {
    // A missing document is not an error: the shared copy may never have existed.
    log.debug(`Deletion of ${entry.id} from ${shared.collection} did not apply.`, err);
  }

  await removePendingDeletion(entry.pack, entry.id);
  return true;
}

/**
 * Confirm and apply every queued deletion.
 * @returns {Promise<number>} how many were applied
 */
export async function applyAllDeletions() {
  const queue = getPendingDeletions();
  if (!queue.length) return 0;

  if (getSetting(SETTINGS.confirmDeletions) !== false) {
    const names = queue
      .slice(0, 10)
      .map((entry) => `<li>${foundry.utils.escapeHTML(entry.name ?? entry.id)}</li>`)
      .join("");
    const more = queue.length > 10 ? t("Deletions.More", { count: queue.length - 10 }) : "";
    const approved = await confirm({
      title: t("Deletions.ConfirmTitle"),
      content: `<p>${t("Deletions.ConfirmBody", { count: queue.length })}</p><ul>${names}</ul><p>${more}</p>`
    });
    if (!approved) return 0;
  }

  let applied = 0;
  for (const entry of queue) {
    if (await applyDeletion(entry)) applied += 1;
  }
  if (applied) info("Deletions.Applied", { count: applied });
  return applied;
}

/**
 * Discard a queued deletion without touching the shared library. The document will simply be
 * pulled back into the mirror on the next sync.
 * @param {{pack: string, id: string}} entry
 */
export async function discardDeletion(entry) {
  await removePendingDeletion(entry.pack, entry.id);
}

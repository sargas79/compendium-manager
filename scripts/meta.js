import { META_DOC_ID, META_DOC_NAME, MODULE_ID, documentClass } from "./constants.js";
import { getMetaPack } from "./packs/shared.js";
import { log } from "./log.js";

/**
 * The meta document lives inside the shared journal pack, which is the only place state can
 * live and still travel between worlds: module settings are world-scoped and would not follow.
 *
 * Shape of `flags[MODULE_ID].meta`:
 *   { systemId, systemVersion, foundryVersion, lastWorld, lastSyncAt, packOwnership }
 */

let cachedDocument = null;

async function loadDocument() {
  const pack = getMetaPack();
  if (!pack) return null;
  if (cachedDocument) return cachedDocument;
  try {
    cachedDocument = (await pack.getDocument(META_DOC_ID)) ?? null;
  } catch (err) {
    log.error("Unable to read the shared meta document.", err);
    cachedDocument = null;
  }
  return cachedDocument;
}

/** @returns {Promise<object|null>} */
export async function readMeta() {
  const document = await loadDocument();
  return document?.getFlag(MODULE_ID, "meta") ?? null;
}

/**
 * Create the meta document if the shared library does not have one yet.
 * @returns {Promise<object|null>} the current meta payload
 */
export async function ensureMeta() {
  const pack = getMetaPack();
  if (!pack) return null;

  const existing = await readMeta();
  if (existing) return existing;

  const payload = {
    systemId: game.system.id,
    systemVersion: game.system.version,
    foundryVersion: game.version,
    lastWorld: game.world.id,
    lastSyncAt: 0,
    packOwnership: {}
  };

  const JournalEntry = documentClass("JournalEntry");
  if (!JournalEntry) return null;

  try {
    const [created] = await JournalEntry.createDocuments(
      [
        {
          _id: META_DOC_ID,
          name: META_DOC_NAME,
          flags: { [MODULE_ID]: { meta: payload } }
        }
      ],
      { pack: pack.collection, keepId: true }
    );
    cachedDocument = created ?? null;
    log.info("Created the shared meta document.");
    return payload;
  } catch (err) {
    log.error("Unable to create the shared meta document.", err);
    return null;
  }
}

/**
 * Merge a patch into the meta payload.
 * @param {object} patch
 */
export async function updateMeta(patch) {
  const document = await loadDocument();
  if (!document) return null;
  const current = document.getFlag(MODULE_ID, "meta") ?? {};
  const next = foundry.utils.mergeObject(foundry.utils.deepClone(current), patch, { inplace: false });
  try {
    await document.setFlag(MODULE_ID, "meta", next);
    return next;
  } catch (err) {
    log.error("Unable to update the shared meta document.", err);
    return null;
  }
}

/** Record that this world just wrote to the shared library. */
export function stampSync() {
  return updateMeta({ lastWorld: game.world.id, lastSyncAt: Date.now() });
}

/** Drop the cached document, e.g. after a pack reload. */
export function invalidateMetaCache() {
  cachedDocument = null;
}

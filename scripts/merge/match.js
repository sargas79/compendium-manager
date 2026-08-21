import { MODULE_ID } from "../constants.js";
import { contentHash, normalisedName, readStamp, sourceReference } from "../sync/revision.js";

/**
 * Identity matching for the merge wizard.
 *
 * The same entry created independently in both worlds has different ids, so id equality alone
 * is not enough. The ladder is: id -> original compendium source -> type + normalised name.
 * Anything matched below the id level is only ever *proposed*, never merged automatically.
 */

export const MATCH_FIELDS = [`flags.${MODULE_ID}`, "_stats.compendiumSource", "type"];

/** Depth of the ladder, from the `duplicateMatching` setting. */
export const MATCH_DEPTH = { id: 1, source: 2, name: 3 };

/**
 * @param {Iterable<object>} sharedIndex Index entries of the shared pack.
 */
export function buildMatchIndex(sharedIndex) {
  const byId = new Map();
  const bySource = new Map();
  const byName = new Map();

  for (const entry of sharedIndex) {
    byId.set(entry._id, entry);

    const source = sourceReference(entry);
    if (source && !bySource.has(source)) bySource.set(source, entry);

    const nameKey = `${entry.type ?? ""}::${normalisedName(entry.name)}`;
    if (!byName.has(nameKey)) byName.set(nameKey, entry);
  }

  return { byId, bySource, byName };
}

/**
 * Classify one incoming document against the shared library.
 *
 * @param {object} source `toObject()` output of the document being adopted.
 * @param {ReturnType<typeof buildMatchIndex>} index
 * @param {number} depth One of MATCH_DEPTH.
 * @returns {{status: string, targetId: string|null, via: string|null}}
 */
export function classify(source, index, depth = MATCH_DEPTH.name) {
  const identical = (entry) => {
    const chash = readStamp(entry)?.chash;
    return chash ? chash === contentHash(source) : false;
  };

  const byId = index.byId.get(source._id);
  if (byId) {
    return {
      status: identical(byId) ? "identical" : "conflict",
      targetId: byId._id,
      via: "id"
    };
  }

  if (depth >= MATCH_DEPTH.source) {
    const reference = sourceReference(source);
    const bySource = reference ? index.bySource.get(reference) : null;
    if (bySource) {
      return {
        status: identical(bySource) ? "identical" : "duplicate",
        targetId: bySource._id,
        via: "source"
      };
    }
  }

  if (depth >= MATCH_DEPTH.name) {
    const nameKey = `${source.type ?? ""}::${normalisedName(source.name)}`;
    const byName = index.byName.get(nameKey);
    if (byName) {
      return {
        status: identical(byName) ? "identical" : "duplicate",
        targetId: byName._id,
        via: "name"
      };
    }
  }

  return { status: "new", targetId: null, via: null };
}

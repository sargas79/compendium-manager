import { MANAGED_TYPES, MODULE_ID, documentClass, sharedPackId } from "../constants.js";
import { SETTINGS, getSetting } from "../settings.js";
import { buildStamp, contentHash, readStamp, syncHash } from "../sync/revision.js";
import { MATCH_DEPTH, MATCH_FIELDS, buildMatchIndex, classify } from "./match.js";
import { syncFolders } from "../sync/folders.js";
import { log } from "../log.js";

/**
 * Adoption: import an existing world compendium into the shared library.
 *
 * Two hard rules, both from PLAN.md §4.3:
 *  - a dry run always comes first and writes nothing;
 *  - nothing is ever deleted from either side.
 */

/** World packs that are candidates for adoption (i.e. not managed by this module). */
export function adoptableSources() {
  const managed = new Set(
    MANAGED_TYPES.flatMap((definition) => [sharedPackId(definition.key), `world.${definition.key}`])
  );
  return game.packs.filter(
    (pack) => !managed.has(pack.collection) && MANAGED_TYPES.some((d) => d.type === pack.documentName)
  );
}

function depthFromSetting() {
  const value = getSetting(SETTINGS.duplicateMatching) ?? "name";
  return MATCH_DEPTH[value] ?? MATCH_DEPTH.name;
}

/**
 * Compare a source pack against the shared library without writing anything.
 *
 * @param {string} sourceCollection Collection id of the pack to adopt.
 * @returns {Promise<object|null>} report
 */
export async function dryRun(sourceCollection) {
  const source = game.packs.get(sourceCollection);
  if (!source) return null;

  const definition = MANAGED_TYPES.find((d) => d.type === source.documentName);
  if (!definition) return null;

  const shared = game.packs.get(sharedPackId(definition.key));
  if (!shared) return null;

  const sharedIndex = await shared.getIndex({ fields: MATCH_FIELDS });
  const index = buildMatchIndex(sharedIndex);
  const depth = depthFromSetting();

  const entries = [];
  const documents = await source.getDocuments();

  for (const document of documents) {
    const data = document.toObject();
    const result = classify(data, index, depth);
    entries.push({
      id: data._id,
      name: data.name ?? data._id,
      type: data.type ?? definition.type,
      status: result.status,
      via: result.via,
      targetId: result.targetId,
      targetName: result.targetId ? index.byId.get(result.targetId)?.name ?? null : null
    });
  }

  return {
    source: sourceCollection,
    sourceLabel: source.title ?? sourceCollection,
    target: shared.collection,
    documentType: definition.type,
    entries,
    counts: summarise(entries),
    createdAt: Date.now()
  };
}

/** @param {object[]} entries */
export function summarise(entries) {
  const counts = { new: 0, identical: 0, conflict: 0, duplicate: 0, total: entries.length };
  for (const entry of entries) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

function stampFor(data, previousRev = 0) {
  const stamp = buildStamp({
    rev: previousRev + 1,
    hash: syncHash(data),
    chash: contentHash(data)
  });
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = stamp;
  return data;
}

/**
 * Apply a reviewed report.
 *
 * @param {object} report Result of `dryRun`.
 * @param {Record<string, string>} resolutions id -> "skip" | "local" | "both"
 * @returns {Promise<{created: number, updated: number, skipped: number}>}
 */
export async function applyReport(report, resolutions = {}) {
  const source = game.packs.get(report.source);
  const shared = game.packs.get(report.target);
  const DocumentClass = documentClass(report.documentType);
  const totals = { created: 0, updated: 0, skipped: 0 };
  if (!source || !shared || !DocumentClass) return totals;

  await syncFolders(source, shared);

  const sharedIndex = await shared.getIndex({ fields: MATCH_FIELDS });
  const creates = [];
  const updates = [];

  for (const entry of report.entries) {
    const choice = resolutions[entry.id] ?? defaultResolution(entry);
    if (choice === "skip") {
      totals.skipped += 1;
      continue;
    }

    const document = await source.getDocument(entry.id);
    if (!document) {
      totals.skipped += 1;
      continue;
    }
    const data = document.toObject();

    if (choice === "both") {
      // Keep both copies: the incoming one becomes a separate document.
      delete data._id;
      creates.push(stampFor(data));
      continue;
    }

    // choice === "local": the incoming document wins.
    if (entry.targetId) {
      const previous = readStamp(sharedIndex.get(entry.targetId))?.rev ?? 0;
      data._id = entry.targetId;
      updates.push(stampFor(data, previous));
    } else {
      creates.push(stampFor(data));
    }
  }

  try {
    if (creates.length) {
      const withIds = creates.filter((d) => !!d._id);
      const withoutIds = creates.filter((d) => !d._id);
      if (withIds.length) {
        await DocumentClass.createDocuments(withIds, { pack: shared.collection, keepId: true });
      }
      if (withoutIds.length) {
        await DocumentClass.createDocuments(withoutIds, { pack: shared.collection });
      }
      totals.created = creates.length;
    }
    if (updates.length) {
      await DocumentClass.updateDocuments(updates, {
        pack: shared.collection,
        diff: false,
        recursive: false
      });
      totals.updated = updates.length;
    }
  } catch (err) {
    log.error("Adoption failed while writing to the shared library.", err);
  }

  return totals;
}

/**
 * Safe defaults: brand new content is imported, anything ambiguous is left alone until the GM
 * decides. Identical content is skipped because there is nothing to do.
 * @param {object} entry
 */
export function defaultResolution(entry) {
  if (entry.status === "new") return "local";
  return "skip";
}

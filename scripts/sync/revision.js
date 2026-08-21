import { MODULE_ID } from "../constants.js";

/**
 * Change detection.
 *
 * Two different hashes are needed:
 *  - `hash`  (sync)    identifies a document's content *including* where it sits, so moving a
 *                      document between folders propagates to the other world.
 *  - `chash` (content) ignores placement and identity, so the merge wizard can recognise the
 *                      same entry that was created independently in both worlds.
 *
 * Neither hash ever reads system data; whole documents are compared as opaque objects.
 */

const IDENTITY_FIELDS = ["_id", "_stats"];
const PLACEMENT_FIELDS = ["folder", "sort", "ownership"];

function stripFields(data, fields) {
  for (const field of fields) delete data[field];
}

function stripOwnFlags(data) {
  if (!data.flags) return;
  delete data.flags[MODULE_ID];
  if (!Object.keys(data.flags).length) delete data.flags;
}

/** Deterministic JSON: object keys sorted, arrays kept in order. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** 32-bit FNV-1a, rendered as 8 hex characters. Collision risk is irrelevant here: a false */
/** "identical" only happens for content that is genuinely being compared field by field.   */
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Hash used to decide whether a document needs syncing.
 * @param {object} source A document's `toObject()` output.
 */
export function syncHash(source) {
  const data = foundry.utils.deepClone(source);
  stripFields(data, IDENTITY_FIELDS);
  stripOwnFlags(data);
  return fnv1a(stableStringify(data));
}

/**
 * Hash used to decide whether two independently created documents are the same content.
 * @param {object} source A document's `toObject()` output.
 */
export function contentHash(source) {
  const data = foundry.utils.deepClone(source);
  stripFields(data, IDENTITY_FIELDS);
  stripFields(data, PLACEMENT_FIELDS);
  stripOwnFlags(data);
  return fnv1a(stableStringify(data));
}

/**
 * Read this module's bookkeeping from a document or an index entry.
 * @param {object} entry
 */
export function readStamp(entry) {
  return entry?.flags?.[MODULE_ID] ?? null;
}

/**
 * Build the bookkeeping flags written on every push.
 * @param {object} options
 * @param {number} options.rev
 * @param {string} options.hash
 * @param {string} options.chash
 */
export function buildStamp({ rev, hash, chash }) {
  return {
    rev,
    hash,
    chash,
    world: game.world.id,
    updatedAt: Date.now()
  };
}

/** The original source pack an entry was dragged from, used for duplicate detection. */
export function sourceReference(source) {
  return source?._stats?.compendiumSource ?? source?.flags?.core?.sourceId ?? null;
}

/** Normalised name used as the weakest duplicate signal. */
export function normalisedName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

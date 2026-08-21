/**
 * Static definitions shared by every part of the module.
 * Nothing here reads game state, so it is safe to import at any lifecycle stage.
 */

export const MODULE_ID = "compendium-manager";

/** The module is explicitly scoped to Pathfinder Second Edition (see PLAN.md §2.1). */
export const REQUIRED_SYSTEM = "pf2e";

/** Fixed id of the meta document that carries cross-world state inside the shared library. */
export const META_DOC_ID = "cmmanifestmeta01";

/** Name of the meta document. The leading dot keeps it at the top of the directory listing. */
export const META_DOC_NAME = ".cm-manifest";

/** Folder that receives preserved local copies when a sync conflict is resolved. */
export const CONFLICT_FOLDER_NAME = "_conflicts";

/**
 * Every managed document type.
 * `key` is the pack name in both the module manifest and the world mirror, which is what keeps
 * a document's UUID identical across the two worlds.
 */
export const MANAGED_TYPES = [
  { type: "Actor", key: "cm-actors", label: "Actors" },
  { type: "Item", key: "cm-items", label: "Items" },
  { type: "JournalEntry", key: "cm-journals", label: "Journal Entries" },
  { type: "RollTable", key: "cm-tables", label: "Roll Tables" },
  { type: "Macro", key: "cm-macros", label: "Macros" },
  { type: "Scene", key: "cm-scenes", label: "Scenes" },
  { type: "Cards", key: "cm-cards", label: "Cards" }
];

/** The journal pack always exists: it stores the meta document. */
export const META_PACK_KEY = "cm-journals";

/** @param {string} key */
export function sharedPackId(key) {
  return `${MODULE_ID}.${key}`;
}

/** @param {string} key */
export function mirrorPackId(key) {
  return `world.${key}`;
}

/** @param {string} type */
export function definitionForType(type) {
  return MANAGED_TYPES.find((d) => d.type === type) ?? null;
}

/** @param {string} collection A pack collection id such as `world.cm-items`. */
export function definitionForMirror(collection) {
  return MANAGED_TYPES.find((d) => mirrorPackId(d.key) === collection) ?? null;
}

/** @param {string} collection A pack collection id such as `compendium-manager.cm-items`. */
export function definitionForShared(collection) {
  return MANAGED_TYPES.find((d) => sharedPackId(d.key) === collection) ?? null;
}

/**
 * Resolve the document class for a managed type without relying on deprecated globals.
 * @param {string} type
 */
export function documentClass(type) {
  return CONFIG[type]?.documentClass ?? null;
}

/** The CompendiumCollection class, namespaced in v14 with a fallback to the global. */
export function compendiumCollectionClass() {
  return foundry?.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
}

import { MANAGED_TYPES, META_PACK_KEY, sharedPackId } from "../constants.js";
import { enabledDefinitions } from "../settings.js";
import { log } from "../log.js";

/**
 * Resolve a shared (module-owned) pack.
 * @param {{key: string}} definition
 * @returns {CompendiumCollection|null}
 */
export function getSharedPack(definition) {
  return game.packs.get(sharedPackId(definition.key)) ?? null;
}

/** The pack that stores the meta document. */
export function getMetaPack() {
  return game.packs.get(sharedPackId(META_PACK_KEY)) ?? null;
}

/**
 * Verify every declared pack is actually present. A missing pack means a broken install,
 * and is reported rather than silently skipped.
 * @returns {string[]} keys of missing packs
 */
export function missingSharedPacks() {
  const missing = [];
  for (const definition of MANAGED_TYPES) {
    if (!getSharedPack(definition)) missing.push(definition.key);
  }
  if (missing.length) log.warn("Shared packs missing from the module:", missing);
  return missing;
}

/** Enabled definitions whose shared pack exists. */
export function availableDefinitions() {
  return enabledDefinitions().filter((definition) => !!getSharedPack(definition));
}

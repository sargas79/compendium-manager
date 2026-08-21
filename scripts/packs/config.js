import { MANAGED_TYPES, compendiumCollectionClass, mirrorPackId, sharedPackId } from "../constants.js";
import { SETTINGS, getSetting } from "../settings.js";
import { readMeta, updateMeta } from "../meta.js";
import { log } from "../log.js";

/**
 * Pack lock state and ownership live in the world-scoped core setting
 * `compendiumConfiguration`, which is why each world has to be configured separately.
 *
 * This module only ever touches entries for packs it manages, and only writes when the
 * current value actually differs. It never edits core or system files.
 */

/** Collection ids of every pack this module manages in the current world. */
export function managedCollections() {
  const ids = [];
  for (const definition of MANAGED_TYPES) {
    if (game.packs.get(sharedPackId(definition.key))) ids.push(sharedPackId(definition.key));
    if (game.packs.get(mirrorPackId(definition.key))) ids.push(mirrorPackId(definition.key));
  }
  return ids;
}

function isManaged(collection) {
  return managedCollections().includes(collection);
}

function currentConfiguration() {
  const CompendiumCollection = compendiumCollectionClass();
  const key = CompendiumCollection?.CONFIG_SETTING ?? "compendiumConfiguration";
  try {
    return game.settings.get("core", key) ?? {};
  } catch (err) {
    log.error("Unable to read the core compendium configuration.", err);
    return {};
  }
}

/**
 * Ensure managed packs are unlocked, and apply any ownership recorded by the other world.
 * Idempotent: a second run performs no writes.
 */
export async function applyPackConfiguration() {
  if (!game.user.isGM) return;

  const configuration = currentConfiguration();
  const meta = await readMeta();
  const propagateOwnership = getSetting(SETTINGS.syncPackOwnership) === true;
  const recorded = propagateOwnership ? meta?.packOwnership ?? {} : {};

  for (const collection of managedCollections()) {
    const pack = game.packs.get(collection);
    if (!pack) continue;

    const existing = configuration[collection] ?? {};
    const changes = {};

    if (existing.locked !== false) changes.locked = false;

    const desiredOwnership = recorded[collection];
    if (desiredOwnership && !foundry.utils.objectsEqual(existing.ownership ?? {}, desiredOwnership)) {
      changes.ownership = foundry.utils.deepClone(desiredOwnership);
    }

    if (!Object.keys(changes).length) continue;

    try {
      await pack.configure(changes);
      log.debug(`Configured ${collection}`, changes);
    } catch (err) {
      log.error(`Unable to configure pack ${collection}`, err);
    }
  }
}

/**
 * Record the ownership the GM has set in this world, so the other world can pick it up.
 * Called when the core compendium configuration changes.
 */
export async function captureOwnership() {
  if (!game.user.isGM) return;
  if (getSetting(SETTINGS.syncPackOwnership) !== true) return;

  const configuration = currentConfiguration();
  const meta = await readMeta();
  const recorded = foundry.utils.deepClone(meta?.packOwnership ?? {});

  let changed = false;
  for (const collection of managedCollections()) {
    const ownership = configuration[collection]?.ownership;
    if (!ownership) continue;
    if (!foundry.utils.objectsEqual(recorded[collection] ?? {}, ownership)) {
      recorded[collection] = foundry.utils.deepClone(ownership);
      changed = true;
    }
  }

  if (!changed) return;
  await updateMeta({ packOwnership: recorded, ownershipWorld: game.world.id, ownershipAt: Date.now() });
  log.debug("Recorded pack ownership for the other world.");
}

/** Hook target: only react to the core compendium configuration setting. */
export function isCompendiumConfigurationSetting(setting) {
  const CompendiumCollection = compendiumCollectionClass();
  const key = CompendiumCollection?.CONFIG_SETTING ?? "compendiumConfiguration";
  return setting?.key === `core.${key}`;
}

export { isManaged };

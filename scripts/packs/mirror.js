import { compendiumCollectionClass, mirrorPackId, sharedPackId } from "../constants.js";
import { availableDefinitions } from "./shared.js";
import { log } from "../log.js";
import { t } from "../ui/notify.js";

/**
 * Resolve the world-local mirror pack for a managed type.
 * @param {{key: string}} definition
 * @returns {CompendiumCollection|null}
 */
export function getMirrorPack(definition) {
  return game.packs.get(mirrorPackId(definition.key)) ?? null;
}

/**
 * Create any missing mirror packs in the current world.
 *
 * The pack name must match in both worlds, because that is what keeps document UUIDs
 * (`Compendium.world.cm-items.Item.<id>`) identical after switching worlds. If Foundry
 * hands back a different collection id than requested we warn loudly rather than proceed
 * with a pack whose UUIDs will not line up.
 *
 * @returns {Promise<CompendiumCollection[]>} the packs that were created
 */
export async function ensureMirrorPacks() {
  const created = [];
  const CompendiumCollection = compendiumCollectionClass();
  if (!CompendiumCollection?.createCompendium) {
    log.error("CompendiumCollection.createCompendium is unavailable; cannot create mirror packs.");
    return created;
  }

  for (const definition of availableDefinitions()) {
    const expected = mirrorPackId(definition.key);
    if (game.packs.get(expected)) continue;

    try {
      const pack = await CompendiumCollection.createCompendium({
        name: definition.key,
        label: t("Packs.MirrorLabel", { type: definition.label }),
        type: definition.type
      });

      if (pack?.collection && pack.collection !== expected) {
        log.warn(
          `Mirror pack for ${definition.type} was created as "${pack.collection}" instead of ` +
            `"${expected}". UUIDs will not match the other world.`
        );
      }
      created.push(pack);
      log.info(`Created mirror pack ${pack?.collection ?? expected}`);
    } catch (err) {
      log.error(`Failed to create mirror pack ${expected}`, err);
    }
  }
  return created;
}

/** Pairs of shared/mirror packs that are ready to sync. */
export function syncablePairs() {
  const pairs = [];
  for (const definition of availableDefinitions()) {
    const mirror = getMirrorPack(definition);
    if (!mirror) continue;
    pairs.push({ definition, mirror, shared: game.packs.get(sharedPackId(definition.key)) });
  }
  return pairs.filter((pair) => !!pair.shared);
}

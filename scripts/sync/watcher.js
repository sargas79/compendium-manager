import { MANAGED_TYPES, definitionForMirror } from "../constants.js";
import { captureOwnership, isCompendiumConfigurationSetting } from "../packs/config.js";
import { isSuppressed, markFoldersDirty, scheduleAutoSync } from "./engine.js";
import { enqueueDeletion, enqueueDirty, clearDirty } from "./state.js";
import { log } from "../log.js";

/**
 * Watches the world mirror packs and records what needs pushing.
 *
 * Only the acting GM client records a change, so a second GM connected to the same world does
 * not duplicate the work. Writes made by the sync engine itself are ignored via the suppression
 * guard, which is what prevents a pull from immediately looking like a local edit.
 */

let registered = false;

function shouldRecord(document, userId) {
  if (!game.user.isGM) return false;
  if (userId !== game.user.id) return false;
  if (isSuppressed()) return false;
  return !!document?.pack && !!definitionForMirror(document.pack);
}

async function onWrite(document, userId) {
  if (!shouldRecord(document, userId)) return;
  await enqueueDirty({
    pack: document.pack,
    id: document.id,
    type: document.documentName,
    name: document.name ?? document.id
  });
  log.debug(`Queued ${document.documentName} ${document.id} from ${document.pack}`);
  scheduleAutoSync();
}

async function onDelete(document, userId) {
  if (!shouldRecord(document, userId)) return;
  // Deletions never propagate on their own; they wait for explicit confirmation.
  await clearDirty(document.pack, document.id);
  await enqueueDeletion({
    pack: document.pack,
    id: document.id,
    type: document.documentName,
    name: document.name ?? document.id
  });
  log.debug(`Queued deletion of ${document.documentName} ${document.id} from ${document.pack}`);
}

function onFolderChange(folder, userId) {
  if (!game.user.isGM || userId !== game.user.id) return;
  if (isSuppressed()) return;
  if (!folder?.pack || !definitionForMirror(folder.pack)) return;
  markFoldersDirty();
  scheduleAutoSync();
}

export function registerWatchers() {
  if (registered) return;
  registered = true;

  for (const definition of MANAGED_TYPES) {
    Hooks.on(`create${definition.type}`, (document, _options, userId) => onWrite(document, userId));
    Hooks.on(`update${definition.type}`, (document, _changes, _options, userId) =>
      onWrite(document, userId)
    );
    Hooks.on(`delete${definition.type}`, (document, _options, userId) => onDelete(document, userId));
  }

  Hooks.on("createFolder", (folder, _options, userId) => onFolderChange(folder, userId));
  Hooks.on("updateFolder", (folder, _changes, _options, userId) => onFolderChange(folder, userId));
  Hooks.on("deleteFolder", (folder, _options, userId) => onFolderChange(folder, userId));

  // Record pack ownership the GM sets in this world so the other world can adopt it.
  Hooks.on("updateSetting", (setting) => {
    if (!isCompendiumConfigurationSetting(setting)) return;
    captureOwnership().catch((err) => log.error("Unable to record pack ownership.", err));
  });

  log.debug("Watchers registered.");
}

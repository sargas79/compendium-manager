import { CONFLICT_FOLDER_NAME, documentClass } from "../constants.js";
import { log } from "../log.js";

/**
 * Compendium folders are ordinary Folder documents living inside the pack. They are copied
 * with `keepId: true` so parent references line up on both sides without remapping.
 */

function folderData(folder) {
  const data = folder.toObject();
  return {
    _id: data._id,
    name: data.name,
    type: data.type,
    folder: data.folder ?? null,
    sort: data.sort ?? 0,
    color: data.color ?? null,
    description: data.description ?? ""
  };
}

/** Sort folders parents-first so a child never references a folder that does not exist yet. */
function byDepth(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const depth = (folder) => {
    let level = 0;
    let current = folder;
    const seen = new Set();
    while (current?.folder && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.folder?.id ?? current.folder);
      level++;
    }
    return level;
  };
  return [...folders].sort((a, b) => depth(a) - depth(b));
}

/**
 * Copy the folder tree from one pack into another, creating what is missing and updating
 * what has drifted. Never deletes folders.
 *
 * @param {CompendiumCollection} source
 * @param {CompendiumCollection} target
 */
export async function syncFolders(source, target) {
  const Folder = documentClass("Folder");
  if (!Folder) return;

  const sourceFolders = [...(source.folders ?? [])];
  if (!sourceFolders.length) return;

  const targetFolders = new Map([...(target.folders ?? [])].map((f) => [f.id, f]));
  const toCreate = [];
  const toUpdate = [];

  for (const folder of byDepth(sourceFolders)) {
    if (folder.name === CONFLICT_FOLDER_NAME) continue; // local-only bookkeeping folder
    const data = folderData(folder);
    const existing = targetFolders.get(folder.id);
    if (!existing) {
      toCreate.push(data);
      continue;
    }
    const drifted =
      existing.name !== data.name ||
      (existing.folder?.id ?? null) !== data.folder ||
      (existing.sort ?? 0) !== data.sort;
    if (drifted) toUpdate.push(data);
  }

  try {
    if (toCreate.length) {
      await Folder.createDocuments(toCreate, { pack: target.collection, keepId: true });
      log.debug(`Created ${toCreate.length} folder(s) in ${target.collection}`);
    }
    if (toUpdate.length) {
      await Folder.updateDocuments(toUpdate, { pack: target.collection });
      log.debug(`Updated ${toUpdate.length} folder(s) in ${target.collection}`);
    }
  } catch (err) {
    log.error(`Folder sync failed for ${target.collection}`, err);
  }
}

/**
 * Get (or create) the folder that receives preserved local copies after a conflict.
 * @param {CompendiumCollection} pack
 * @returns {Promise<string|null>} folder id
 */
export async function ensureConflictFolder(pack) {
  const existing = [...(pack.folders ?? [])].find((f) => f.name === CONFLICT_FOLDER_NAME);
  if (existing) return existing.id;

  const Folder = documentClass("Folder");
  if (!Folder) return null;
  try {
    const [folder] = await Folder.createDocuments(
      [{ name: CONFLICT_FOLDER_NAME, type: pack.documentName, sort: -100000 }],
      { pack: pack.collection }
    );
    return folder?.id ?? null;
  } catch (err) {
    log.error(`Unable to create the ${CONFLICT_FOLDER_NAME} folder in ${pack.collection}`, err);
    return null;
  }
}

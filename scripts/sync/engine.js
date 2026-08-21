import { META_DOC_ID, MODULE_ID, documentClass } from "../constants.js";
import { SETTINGS, getSetting, setSetting } from "../settings.js";
import { syncablePairs } from "../packs/mirror.js";
import { ensureConflictFolder, syncFolders } from "./folders.js";
import { buildStamp, contentHash, readStamp, syncHash } from "./revision.js";
import { clearDirty, getDirtyQueue, isDirty } from "./state.js";
import { stampSync } from "../meta.js";
import { log } from "../log.js";
import { info, t, warn } from "../ui/notify.js";

const INDEX_FIELDS = [`flags.${MODULE_ID}`];

const state = {
  suppress: 0,
  running: false,
  timer: null,
  foldersDirty: false
};

/** Folder changes carry no dirty-queue entry of their own, so they are flagged separately. */
export function markFoldersDirty() {
  state.foldersDirty = true;
}

/** True while the engine is performing its own writes, so the watcher can ignore them. */
export function isSuppressed() {
  return state.suppress > 0;
}

async function withoutWatching(fn) {
  state.suppress += 1;
  try {
    return await fn();
  } finally {
    state.suppress -= 1;
  }
}

export function isRunning() {
  return state.running;
}

async function indexOf(pack) {
  return pack.getIndex({ fields: INDEX_FIELDS });
}

async function sourceOf(pack, id) {
  try {
    const document = await pack.getDocument(id);
    return document ? document.toObject() : null;
  } catch (err) {
    log.error(`Unable to read ${id} from ${pack.collection}`, err);
    return null;
  }
}

/* -------------------------------------------- */
/*  Pull: shared library -> world mirror         */
/* -------------------------------------------- */

/**
 * Preserve the local version of a conflicted document before the shared version overwrites it.
 * Nothing is deleted; the local copy lands in the `_conflicts` folder under a new id.
 */
async function preserveLocalCopy({ mirror, DocumentClass, id }) {
  const local = await sourceOf(mirror, id);
  if (!local) return false;

  const folderId = await ensureConflictFolder(mirror);
  const copy = foundry.utils.deepClone(local);
  delete copy._id;
  delete copy._stats;
  if (copy.flags) delete copy.flags[MODULE_ID];
  copy.folder = folderId ?? null;
  copy.name = t("Sync.ConflictCopyName", {
    name: local.name ?? id,
    world: game.world.id,
    date: new Date().toLocaleString()
  });

  try {
    await DocumentClass.createDocuments([copy], { pack: mirror.collection });
    return true;
  } catch (err) {
    log.error(`Unable to preserve the local copy of ${id} in ${mirror.collection}`, err);
    return false;
  }
}

async function pullPack({ definition, shared, mirror }) {
  const DocumentClass = documentClass(definition.type);
  if (!DocumentClass) return { created: 0, updated: 0, conflicts: 0 };

  await syncFolders(shared, mirror);

  const [sharedIndex, mirrorIndex] = await Promise.all([indexOf(shared), indexOf(mirror)]);
  const creates = [];
  const updates = [];
  const conflicts = [];

  for (const entry of sharedIndex) {
    if (entry._id === META_DOC_ID) continue; // bookkeeping, never mirrored

    const local = mirrorIndex.get(entry._id);
    if (!local) {
      creates.push(entry._id);
      continue;
    }

    const remoteHash = readStamp(entry)?.hash;
    const localHash = readStamp(local)?.hash;
    if (remoteHash && localHash && remoteHash === localHash) continue;

    if (isDirty(mirror.collection, entry._id)) conflicts.push(entry._id);
    else updates.push(entry._id);
  }

  if (!creates.length && !updates.length && !conflicts.length) {
    return { created: 0, updated: 0, conflicts: 0 };
  }

  await withoutWatching(async () => {
    const createData = [];
    for (const id of creates) {
      const data = await sourceOf(shared, id);
      if (data) createData.push(data);
    }
    if (createData.length) {
      await DocumentClass.createDocuments(createData, { pack: mirror.collection, keepId: true });
    }

    const updateData = [];
    for (const id of updates) {
      const data = await sourceOf(shared, id);
      if (data) updateData.push(data);
    }
    if (updateData.length) {
      await DocumentClass.updateDocuments(updateData, {
        pack: mirror.collection,
        diff: false,
        recursive: false
      });
    }

    for (const id of conflicts) {
      await preserveLocalCopy({ mirror, DocumentClass, id });
      const data = await sourceOf(shared, id);
      if (!data) continue;
      await DocumentClass.updateDocuments([data], {
        pack: mirror.collection,
        diff: false,
        recursive: false
      });
      await clearDirty(mirror.collection, id);
    }
  });

  return { created: creates.length, updated: updates.length, conflicts: conflicts.length };
}

/**
 * Bring this world's mirror packs up to date with the shared library.
 * @param {object} [options]
 * @param {boolean} [options.notify]
 */
export async function pull({ notify = true } = {}) {
  if (!game.user.isGM || state.running) return null;
  state.running = true;
  const totals = { created: 0, updated: 0, conflicts: 0 };

  try {
    for (const pair of syncablePairs()) {
      const result = await pullPack(pair);
      totals.created += result.created;
      totals.updated += result.updated;
      totals.conflicts += result.conflicts;
    }
  } catch (err) {
    log.error("Pull failed.", err);
    warn("Sync.PullFailed");
  } finally {
    state.running = false;
  }

  if (totals.conflicts) warn("Sync.ConflictsResolved", { count: totals.conflicts });
  if (notify && (totals.created || totals.updated)) info("Sync.PullDone", totals);
  log.debug("Pull complete", totals);
  return totals;
}

/* -------------------------------------------- */
/*  Push: world mirror -> shared library         */
/* -------------------------------------------- */

async function pushPack({ definition, shared, mirror }, entries) {
  const DocumentClass = documentClass(definition.type);
  if (!DocumentClass) return { created: 0, updated: 0 };

  await syncFolders(mirror, shared);

  const sharedIndex = await indexOf(shared);
  const creates = [];
  const updates = [];
  const stamps = [];
  const handled = [];

  for (const entry of entries) {
    const data = await sourceOf(mirror, entry.id);
    if (!data) {
      // The document disappeared from the mirror; deletions are handled separately.
      handled.push(entry.id);
      continue;
    }

    const hash = syncHash(data);
    const remote = sharedIndex.get(entry.id);
    const remoteStamp = readStamp(remote);

    if (remoteStamp?.hash === hash) {
      handled.push(entry.id);
      continue;
    }

    const stamp = buildStamp({
      rev: (remoteStamp?.rev ?? 0) + 1,
      hash,
      chash: contentHash(data)
    });
    data.flags = data.flags ?? {};
    data.flags[MODULE_ID] = stamp;

    if (remote) updates.push(data);
    else creates.push(data);
    stamps.push({ _id: entry.id, flags: { [MODULE_ID]: stamp } });
    handled.push(entry.id);
  }

  if (creates.length) {
    await DocumentClass.createDocuments(creates, { pack: shared.collection, keepId: true });
  }
  if (updates.length) {
    await DocumentClass.updateDocuments(updates, {
      pack: shared.collection,
      diff: false,
      recursive: false
    });
  }
  if (stamps.length) {
    // Mirror the bookkeeping back so both sides agree on the current hash.
    await withoutWatching(() => DocumentClass.updateDocuments(stamps, { pack: mirror.collection }));
  }

  for (const id of handled) await clearDirty(mirror.collection, id);
  return { created: creates.length, updated: updates.length };
}

/**
 * Write pending local edits into the shared library.
 * @param {object} [options]
 * @param {boolean} [options.notify]
 */
export async function push({ notify = true } = {}) {
  if (!game.user.isGM || state.running) return null;

  const queue = getDirtyQueue();
  if (!queue.length && !state.foldersDirty) return { created: 0, updated: 0 };

  state.running = true;
  const totals = { created: 0, updated: 0 };

  try {
    if (state.foldersDirty) {
      for (const pair of syncablePairs()) await syncFolders(pair.mirror, pair.shared);
      state.foldersDirty = false;
    }

    for (const pair of syncablePairs()) {
      const entries = queue.filter((entry) => entry.pack === pair.mirror.collection);
      if (!entries.length) continue;
      const result = await pushPack(pair, entries);
      totals.created += result.created;
      totals.updated += result.updated;
    }
    await stampSync();
    await setSetting(SETTINGS.lastSyncAt, Date.now());
  } catch (err) {
    log.error("Push failed.", err);
    warn("Sync.PushFailed");
  } finally {
    state.running = false;
  }

  if (notify && (totals.created || totals.updated)) info("Sync.PushDone", totals);
  log.debug("Push complete", totals);
  return totals;
}

/** Push local edits, then pull anything new from the shared library. */
export async function syncNow({ notify = true } = {}) {
  const pushed = await push({ notify: false });
  const pulled = await pull({ notify: false });
  if (notify) {
    info("Sync.SyncDone", {
      pushed: (pushed?.created ?? 0) + (pushed?.updated ?? 0),
      pulled: (pulled?.created ?? 0) + (pulled?.updated ?? 0)
    });
  }
  Hooks.callAll("compendiumManagerSyncComplete", { pushed, pulled });
  return { pushed, pulled };
}

/** Debounced automatic push, scheduled by the watcher after a mirror edit. */
export function scheduleAutoSync() {
  if (getSetting(SETTINGS.autoSync) !== true) return;
  const delay = Math.max(1, Number(getSetting(SETTINGS.syncDebounce) ?? 5)) * 1000;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    push({ notify: false }).catch((err) => log.error("Automatic push failed.", err));
  }, delay);
}

/** Cancel a pending automatic push, e.g. when the module is disabled mid-session. */
export function cancelAutoSync() {
  if (!state.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
}

export { withoutWatching };

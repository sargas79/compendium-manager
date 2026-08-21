import { SETTINGS, getSetting, setSetting } from "../settings.js";

/**
 * The dirty queue and the tombstone queue are world-scoped settings so they survive a reload:
 * an edit made just before the GM closes the world must still be pushed on the next start.
 *
 * Queue entries: { pack, id, type, name }
 */

function key(pack, id) {
  return `${pack}::${id}`;
}

export function getDirtyQueue() {
  return getSetting(SETTINGS.dirtyQueue) ?? [];
}

export function isDirty(pack, id) {
  return getDirtyQueue().some((entry) => entry.pack === pack && entry.id === id);
}

/** @returns {Promise<void>} */
export async function enqueueDirty({ pack, id, type, name }) {
  const queue = getDirtyQueue();
  if (queue.some((entry) => key(entry.pack, entry.id) === key(pack, id))) return;
  queue.push({ pack, id, type, name });
  await setSetting(SETTINGS.dirtyQueue, queue);
}

export async function clearDirty(pack, id) {
  const queue = getDirtyQueue().filter((entry) => key(entry.pack, entry.id) !== key(pack, id));
  await setSetting(SETTINGS.dirtyQueue, queue);
}

export async function clearAllDirty() {
  await setSetting(SETTINGS.dirtyQueue, []);
}

export function getPendingDeletions() {
  return getSetting(SETTINGS.pendingDeletions) ?? [];
}

export async function enqueueDeletion({ pack, id, type, name }) {
  const queue = getPendingDeletions();
  if (queue.some((entry) => key(entry.pack, entry.id) === key(pack, id))) return;
  queue.push({ pack, id, type, name, queuedAt: Date.now() });
  await setSetting(SETTINGS.pendingDeletions, queue);
}

export async function removePendingDeletion(pack, id) {
  const queue = getPendingDeletions().filter((entry) => key(entry.pack, entry.id) !== key(pack, id));
  await setSetting(SETTINGS.pendingDeletions, queue);
}

export async function clearPendingDeletions() {
  await setSetting(SETTINGS.pendingDeletions, []);
}

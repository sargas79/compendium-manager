import { MANAGED_TYPES, MODULE_ID } from "./constants.js";

export const SETTINGS = {
  enabledTypes: "enabledTypes",
  autoSync: "autoSync",
  syncDebounce: "syncDebounce",
  syncPackOwnership: "syncPackOwnership",
  confirmDeletions: "confirmDeletions",
  duplicateMatching: "duplicateMatching",
  debug: "debug",
  dirtyQueue: "dirtyQueue",
  pendingDeletions: "pendingDeletions",
  lastSyncAt: "lastSyncAt"
};

function defaultEnabledTypes() {
  return Object.fromEntries(MANAGED_TYPES.map((d) => [d.type, true]));
}

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);

  register(SETTINGS.autoSync, {
    name: "COMPENDIUM_MANAGER.Settings.AutoSync.Name",
    hint: "COMPENDIUM_MANAGER.Settings.AutoSync.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.syncDebounce, {
    name: "COMPENDIUM_MANAGER.Settings.SyncDebounce.Name",
    hint: "COMPENDIUM_MANAGER.Settings.SyncDebounce.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 120, step: 1 },
    default: 5
  });

  register(SETTINGS.syncPackOwnership, {
    name: "COMPENDIUM_MANAGER.Settings.SyncPackOwnership.Name",
    hint: "COMPENDIUM_MANAGER.Settings.SyncPackOwnership.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.confirmDeletions, {
    name: "COMPENDIUM_MANAGER.Settings.ConfirmDeletions.Name",
    hint: "COMPENDIUM_MANAGER.Settings.ConfirmDeletions.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.duplicateMatching, {
    name: "COMPENDIUM_MANAGER.Settings.DuplicateMatching.Name",
    hint: "COMPENDIUM_MANAGER.Settings.DuplicateMatching.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      id: "COMPENDIUM_MANAGER.Settings.DuplicateMatching.Id",
      source: "COMPENDIUM_MANAGER.Settings.DuplicateMatching.Source",
      name: "COMPENDIUM_MANAGER.Settings.DuplicateMatching.Name_"
    },
    default: "name"
  });

  register(SETTINGS.debug, {
    name: "COMPENDIUM_MANAGER.Settings.Debug.Name",
    hint: "COMPENDIUM_MANAGER.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  // Internal state. Never shown in the configuration sheet.
  register(SETTINGS.enabledTypes, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultEnabledTypes()
  });

  register(SETTINGS.dirtyQueue, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  register(SETTINGS.pendingDeletions, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  register(SETTINGS.lastSyncAt, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

/** @param {string} key */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/** @param {string} key */
export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/** Managed type definitions the GM has left enabled. */
export function enabledDefinitions() {
  const enabled = getSetting(SETTINGS.enabledTypes) ?? {};
  return MANAGED_TYPES.filter((d) => enabled[d.type] !== false);
}

import { MANAGED_TYPES, MODULE_ID, sharedPackId } from "../constants.js";
import { SETTINGS, getSetting, setSetting } from "../settings.js";
import { availableDefinitions } from "../packs/shared.js";
import { getMirrorPack } from "../packs/mirror.js";
import { getDirtyQueue, getPendingDeletions } from "../sync/state.js";
import { applyAllDeletions, discardDeletion } from "../sync/deletions.js";
import { isRunning, pull, syncNow } from "../sync/engine.js";
import { openMergeWizard } from "./merge-app.js";
import { t } from "./notify.js";
import { log } from "../log.js";

let ManagerApplication = null;
let instance = null;

function defineApplication() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  return class CompendiumManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "compendium-manager-app",
      classes: ["compendium-manager"],
      tag: "div",
      window: {
        title: "COMPENDIUM_MANAGER.App.Title",
        icon: "fa-solid fa-book-atlas",
        resizable: true
      },
      position: { width: 700, height: "auto" },
      actions: {
        sync: CompendiumManagerApp.#onSync,
        pull: CompendiumManagerApp.#onPull,
        merge: CompendiumManagerApp.#onMerge,
        applyDeletions: CompendiumManagerApp.#onApplyDeletions,
        discardDeletion: CompendiumManagerApp.#onDiscardDeletion,
        toggleType: CompendiumManagerApp.#onToggleType
      }
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/manager.hbs` }
    };

    async _prepareContext(_options) {
      const dirty = getDirtyQueue();
      const enabled = getSetting(SETTINGS.enabledTypes) ?? {};
      const available = availableDefinitions();
      const rows = [];

      for (const definition of MANAGED_TYPES) {
        const isEnabled = enabled[definition.type] !== false;
        const shared = game.packs.get(sharedPackId(definition.key));
        const mirror = getMirrorPack(definition);

        let sharedCount = 0;
        let mirrorCount = 0;
        if (isEnabled) {
          try {
            sharedCount = (await shared?.getIndex())?.size ?? 0;
            mirrorCount = (await mirror?.getIndex())?.size ?? 0;
          } catch (err) {
            log.debug(`Unable to index ${definition.key} for display.`, err);
          }
        }

        rows.push({
          type: definition.type,
          label: definition.label,
          enabled: isEnabled,
          sharedMissing: !shared,
          mirrorMissing: isEnabled && !mirror,
          sharedCount,
          mirrorCount,
          dirty: dirty.filter((entry) => entry.pack === mirror?.collection).length
        });
      }

      const lastSyncAt = getSetting(SETTINGS.lastSyncAt) ?? 0;

      return {
        rows,
        managedCount: available.length,
        dirtyTotal: dirty.length,
        deletions: getPendingDeletions(),
        autoSync: getSetting(SETTINGS.autoSync) === true,
        debounce: getSetting(SETTINGS.syncDebounce),
        running: isRunning(),
        world: game.world.id,
        lastSync: lastSyncAt ? new Date(lastSyncAt).toLocaleString() : t("App.Never")
      };
    }

    static async #onSync() {
      await syncNow();
      this.render();
    }

    static async #onPull() {
      await pull();
      this.render();
    }

    static #onMerge() {
      openMergeWizard();
    }

    static async #onApplyDeletions() {
      await applyAllDeletions();
      this.render();
    }

    static async #onDiscardDeletion(_event, target) {
      const { pack, id } = target.dataset;
      if (!pack || !id) return;
      await discardDeletion({ pack, id });
      this.render();
    }

    static async #onToggleType(_event, target) {
      const type = target.dataset.type;
      if (!type) return;
      const enabled = foundry.utils.deepClone(getSetting(SETTINGS.enabledTypes) ?? {});
      enabled[type] = enabled[type] === false;
      await setSetting(SETTINGS.enabledTypes, enabled);
      this.render();
    }
  };
}

/** Open (or focus) the manager window. GM only. */
export function openManager() {
  if (!game.user.isGM) return null;
  if (!ManagerApplication) ManagerApplication = defineApplication();
  if (!instance) instance = new ManagerApplication();
  instance.render({ force: true });
  return instance;
}

/** Re-render the manager if it is open. */
export function refreshManager() {
  if (instance?.rendered) instance.render();
}

/**
 * Settings-menu entry point. Foundry instantiates and renders the class it is given, so this
 * shim simply forwards to the real window.
 */
export function managerMenuClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class CompendiumManagerMenu extends ApplicationV2 {
    async render(..._args) {
      openManager();
      return this;
    }
  };
}

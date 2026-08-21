import { MODULE_ID, REQUIRED_SYSTEM } from "./constants.js";
import { SETTINGS, getSetting, registerSettings } from "./settings.js";
import { missingSharedPacks } from "./packs/shared.js";
import { ensureMirrorPacks } from "./packs/mirror.js";
import { applyPackConfiguration } from "./packs/config.js";
import { ensureMeta, readMeta, updateMeta } from "./meta.js";
import { registerWatchers } from "./sync/watcher.js";
import { cancelAutoSync, pull, push, syncNow } from "./sync/engine.js";
import { applyAllDeletions } from "./sync/deletions.js";
import { dryRun, applyReport } from "./merge/adopt.js";
import { openManager, managerMenuClass, refreshManager } from "./ui/manager-app.js";
import { openMergeWizard } from "./ui/merge-app.js";
import { error, info, t, warn } from "./ui/notify.js";
import { log } from "./log.js";

/**
 * Compendium Manager — shares one compendium library between two pf2e worlds.
 * See PLAN.md for the design, its constraints, and what this module deliberately does not do.
 *
 * It never modifies Foundry core files or the pf2e system: everything happens through
 * documented hooks and public document APIs.
 */

let active = false;

/** The module only runs on pf2e (PLAN.md §2.1). */
function systemSupported() {
  return game.system.id === REQUIRED_SYSTEM;
}

function registerHandlebarsHelpers() {
  // Own helper rather than relying on a core one that may not exist in every version.
  Handlebars.registerHelper("cmEq", (a, b) => a === b);
}

async function warnOnSystemDrift() {
  const meta = await readMeta();
  if (!meta) return;

  if (meta.systemId && meta.systemId !== game.system.id) {
    error("Errors.SystemMismatch", { recorded: meta.systemId, current: game.system.id });
    return false;
  }
  if (meta.systemVersion && meta.systemVersion !== game.system.version) {
    warn("Errors.VersionDrift", {
      recorded: meta.systemVersion,
      current: game.system.version
    });
    await updateMeta({ systemVersion: game.system.version, foundryVersion: game.version });
  }
  return true;
}

Hooks.once("init", () => {
  registerSettings();
  registerHandlebarsHelpers();

  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "COMPENDIUM_MANAGER.Settings.Manager.Name",
    label: "COMPENDIUM_MANAGER.Settings.Manager.Label",
    hint: "COMPENDIUM_MANAGER.Settings.Manager.Hint",
    icon: "fa-solid fa-book-atlas",
    type: managerMenuClass(),
    restricted: true
  });

  log.debug("Initialised.");
});

Hooks.once("setup", () => {
  if (!systemSupported()) {
    log.warn(`Inactive: this module requires the ${REQUIRED_SYSTEM} system.`);
  }
});

Hooks.once("ready", async () => {
  const module = game.modules.get(MODULE_ID);

  // Public API, available whether or not the module is active in this world.
  if (module) {
    module.api = {
      open: openManager,
      openMergeWizard,
      syncNow,
      push,
      pull,
      dryRun,
      applyReport,
      applyAllDeletions,
      isActive: () => active
    };
  }

  if (!systemSupported()) {
    if (game.user.isGM) error("Errors.WrongSystem", { system: REQUIRED_SYSTEM });
    return;
  }

  if (!game.user.isGM) {
    // Players never sync, configure, or create packs. They simply see the packs their role allows.
    active = true;
    return;
  }

  const missing = missingSharedPacks();
  if (missing.length) warn("Errors.MissingPacks", { packs: missing.join(", ") });

  try {
    await ensureMeta();
    if ((await warnOnSystemDrift()) === false) return;

    await ensureMirrorPacks();
    await applyPackConfiguration();
    registerWatchers();

    await pull({ notify: false });

    // An edit made just before the previous shutdown may still be queued.
    await push({ notify: false });

    active = true;
    refreshManager();
    log.info(`Active in world "${game.world.id}".`);
    if (getSetting(SETTINGS.debug)) info("App.Ready");
  } catch (err) {
    log.error("Startup failed.", err);
    error("Errors.StartupFailed");
  }
});

/** Add a manager button to the compendium sidebar, failing quietly if the markup changes. */
Hooks.on("renderCompendiumDirectory", (_app, element) => {
  if (!game.user.isGM || !active) return;
  try {
    const root = element instanceof HTMLElement ? element : element?.[0];
    const header = root?.querySelector(".directory-header, .header-actions");
    if (!header || root.querySelector(".cm-open-manager")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("cm-open-manager");
    button.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${t("App.Button")}`;
    button.addEventListener("click", () => openManager());
    header.append(button);
  } catch (err) {
    log.debug("Could not add the sidebar button.", err);
  }
});

/** Stop any pending automatic push if the page is going away. */
window.addEventListener("beforeunload", () => cancelAutoSync());

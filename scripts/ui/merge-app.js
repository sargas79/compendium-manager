import { MODULE_ID } from "../constants.js";
import { adoptableSources, applyReport, defaultResolution, dryRun } from "../merge/adopt.js";
import { pull } from "../sync/engine.js";
import { confirm, info, t, warn } from "./notify.js";
import { log } from "../log.js";

let MergeApplication = null;
let instance = null;

function defineApplication() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  return class MergeWizardApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #report = null;
    #resolutions = {};
    #source = null;

    static DEFAULT_OPTIONS = {
      id: "compendium-manager-merge",
      classes: ["compendium-manager", "compendium-manager-merge"],
      tag: "div",
      window: {
        title: "COMPENDIUM_MANAGER.Merge.Title",
        icon: "fa-solid fa-code-merge",
        resizable: true
      },
      position: { width: 760, height: 640 },
      actions: {
        analyse: MergeWizardApp.#onAnalyse,
        apply: MergeWizardApp.#onApply,
        reset: MergeWizardApp.#onReset,
        setAll: MergeWizardApp.#onSetAll
      }
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/merge.hbs` }
    };

    async _prepareContext(_options) {
      const sources = adoptableSources().map((pack) => ({
        collection: pack.collection,
        label: `${pack.title} (${pack.documentName})`,
        selected: pack.collection === this.#source
      }));

      const entries = (this.#report?.entries ?? []).map((entry) => ({
        ...entry,
        resolution: this.#resolutions[entry.id] ?? defaultResolution(entry),
        statusLabel: t(`Merge.Status.${entry.status}`),
        viaLabel: entry.via ? t(`Merge.Via.${entry.via}`) : ""
      }));

      return {
        sources,
        hasSources: sources.length > 0,
        report: this.#report,
        counts: this.#report?.counts ?? null,
        entries,
        hasReport: !!this.#report
      };
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;

      root.querySelector("[data-source-select]")?.addEventListener("change", (event) => {
        this.#source = event.target.value;
      });

      for (const select of root.querySelectorAll("[data-resolution]")) {
        select.addEventListener("change", (event) => {
          this.#resolutions[event.target.dataset.entryId] = event.target.value;
        });
      }
    }

    static async #onAnalyse() {
      const app = this;
      const select = app.element.querySelector("[data-source-select]");
      app.#source = select?.value ?? app.#source;
      if (!app.#source) {
        warn("Merge.NoSource");
        return;
      }

      try {
        app.#report = await dryRun(app.#source);
        app.#resolutions = {};
        if (!app.#report) warn("Merge.NoTarget");
      } catch (err) {
        log.error("Dry run failed.", err);
        warn("Merge.AnalyseFailed");
      }
      app.render();
    }

    static async #onSetAll(_event, target) {
      const app = this;
      if (!app.#report) return;
      const { status, value } = target.dataset;
      for (const entry of app.#report.entries) {
        if (entry.status === status) app.#resolutions[entry.id] = value;
      }
      app.render();
    }

    static async #onApply() {
      const app = this;
      if (!app.#report) return;

      const resolutions = {};
      for (const entry of app.#report.entries) {
        resolutions[entry.id] = app.#resolutions[entry.id] ?? defaultResolution(entry);
      }

      const willWrite = Object.values(resolutions).filter((value) => value !== "skip").length;
      if (!willWrite) {
        info("Merge.NothingToDo");
        return;
      }

      // Pack titles are author-supplied, and game.i18n.format does not escape its
      // substitutions, so escape before building the dialog markup.
      const escape = foundry.utils.escapeHTML;
      const approved = await confirm({
        title: t("Merge.ConfirmTitle"),
        content: `<p>${t("Merge.ConfirmBody", {
          count: willWrite,
          source: escape(app.#report.sourceLabel ?? ""),
          target: escape(app.#report.target ?? "")
        })}</p><p>${t("Merge.ConfirmNoDelete")}</p>`
      });
      if (!approved) return;

      const totals = await applyReport(app.#report, resolutions);
      info("Merge.Applied", totals);

      // Bring the newly shared content into this world's mirror.
      await pull({ notify: false });

      app.#report = await dryRun(app.#source);
      app.#resolutions = {};
      app.render();
    }

    static #onReset() {
      const app = this;
      app.#report = null;
      app.#resolutions = {};
      app.render();
    }
  };
}

/** Open the adoption / merge wizard. GM only. */
export function openMergeWizard() {
  if (!game.user.isGM) return null;
  if (!MergeApplication) MergeApplication = defineApplication();
  if (!instance) instance = new MergeApplication();
  instance.render({ force: true });
  return instance;
}

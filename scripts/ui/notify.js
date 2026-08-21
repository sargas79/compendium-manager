import { MODULE_ID } from "../constants.js";

/**
 * Localisation helper. Every player-visible string goes through here.
 * @param {string} key Key below `COMPENDIUM_MANAGER.`
 * @param {object} [data]
 */
export function t(key, data) {
  const full = `COMPENDIUM_MANAGER.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function info(key, data) {
  ui.notifications?.info(t(key, data));
}

export function warn(key, data) {
  ui.notifications?.warn(t(key, data));
}

export function error(key, data) {
  ui.notifications?.error(t(key, data));
}

/**
 * Confirmation dialog used before every destructive or bulk operation.
 * @param {object} options
 * @param {string} options.title Already-localised title.
 * @param {string} options.content Already-localised HTML content.
 * @returns {Promise<boolean>}
 */
export async function confirm({ title, content }) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) {
    // Extremely defensive: never perform a destructive action if we cannot ask.
    console.warn(`[${MODULE_ID}] DialogV2 unavailable; refusing to confirm implicitly.`);
    return false;
  }
  return DialogV2.confirm({
    window: { title },
    content,
    modal: true,
    rejectClose: false
  });
}

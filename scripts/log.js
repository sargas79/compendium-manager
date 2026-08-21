import { MODULE_ID } from "./constants.js";

const PREFIX = `[${MODULE_ID}]`;

function debugEnabled() {
  try {
    return game.settings.get(MODULE_ID, "debug") === true;
  } catch (_err) {
    // Settings are not registered yet during early init.
    return false;
  }
}

export const log = {
  /** Verbose tracing, only shown when the debug setting is on. */
  debug(...args) {
    if (debugEnabled()) console.debug(PREFIX, ...args);
  },

  info(...args) {
    console.log(PREFIX, ...args);
  },

  warn(...args) {
    console.warn(PREFIX, ...args);
  },

  /**
   * Errors are always logged. Stack traces are only expanded in debug mode so ordinary
   * users are not shown internals.
   * @param {string} message
   * @param {Error} [error]
   */
  error(message, error) {
    console.error(PREFIX, message);
    if (error && debugEnabled()) console.error(error);
  }
};

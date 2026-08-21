# Changelog

All notable changes to this module are documented here.

## [0.1.0] — 2026-08-20

Initial release. Written against the published Foundry v14 API documentation; not yet run
inside Foundry (see README *Status*).

### Added
- Seven shared module compendiums (Actors, Items, Journal Entries, Roll Tables, Macros, Scenes,
  Cards) that every world enabling the module can see.
- World mirror packs created automatically per world, with matching pack names so document UUIDs
  stay stable across worlds.
- Two-way sync between mirror and shared library: pull on startup, debounced push after edits,
  and a manual **Sync now**.
- Change detection by content hash, with per-document revision bookkeeping stored in module
  flags and a meta document that travels inside the shared library.
- Conflict handling that keeps the shared version and preserves the local one in a `_conflicts`
  folder.
- Deletion queue: removing a document from a mirror pack never removes the shared copy until
  the GM confirms.
- Merge wizard for adopting existing world compendiums, with a mandatory dry run and duplicate
  detection by id, original compendium source, or name and type.
- Automatic per-world unlocking of managed packs, and optional propagation of pack ownership
  between worlds.
- GM-only manager window, module settings, English localisation, and a public API on
  `game.modules.get("compendium-manager").api`.
- Manifest-URL distribution: a tagged push builds and publishes `module.json` and `module.zip`
  as GitHub release assets, with the version taken from the tag.

### Notes
- Scoped to Pathfinder Second Edition; the module refuses to initialise on any other system.
- No Foundry core file or pf2e system file is created, edited, or deleted, and no core class is
  patched.

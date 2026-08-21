# Compendium Manager — Design Plan

A Foundry VTT **v14** module that gives two worlds a single shared compendium library,
by mirroring world-local compendiums into module-owned packs on disk.

- **Module id:** `compendium-manager`
- **Title:** Compendium Manager
- **Author:** Diego Vescovini

Status: **plan only — no implementation yet.**

Target worlds (from setup screenshots):

| World | Data path | System | Role |
|---|---|---|---|
| Thar - Calamity | `Data/worlds/thar-calamity` | Pathfinder Second Edition (`pf2e`) | seeds the shared library |
| Thar - Whispers of the First Dawn | `Data/worlds/thar-whispers-of-the-first-dawn` | Pathfinder Second Edition (`pf2e`) | merged in second |

Three other worlds (the Queens Blade set) exist on the same install. The module is enabled per
world, so it stays off there unless you choose otherwise.

---

## 1. Problem and the mechanism that solves it

Two worlds on one self-hosted Foundry instance (Docker/VPS, single data volume) must share
compendium content. Only one world runs at a time (single licence).

World compendiums live in `Data/worlds/<world>/packs/` — private to that world.
**Module compendiums live in `Data/modules/<module-id>/packs/` and are visible to every world
that enables the module.** That is the entire sharing mechanism; it requires no code.

Because the worlds never run concurrently there is no LevelDB lock contention and no true
concurrent-write conflict. Everything below is bookkeeping, not distributed systems.

Both worlds run `pf2e`, so Actors and Items are safe to share — that was the one thing that
could have ruled out half the document types.

### Chosen workflow: mirror

- **Shared module packs** (`compendium-manager.cm-items`, …) are the canonical store on disk.
- **World mirror packs** (`world.cm-items`, …) are created by the module in each world. You work
  in the mirror; it behaves like a normal world compendium.
- The module pulls shared → mirror at startup and pushes mirror → shared after edits.

**Why the mirror pays for itself here:** the mirror pack is created with the *same pack name* in
both worlds, so a document keeps the UUID `Compendium.world.cm-items.Item.<id>` in Calamity and
Whispers alike. Links, macros, and actor references written against the mirror survive the world
switch. Documents are always copied with `keepId: true`.

**What it costs:** two copies of every document on disk, plus sync machinery that can be wrong.
Editing the module pack directly would avoid both. I recommended that; you chose mirroring, so
this plan implements mirroring — with the safety rules in §6 to keep it honest.

---

## 2. Scope

### In scope (v1)
- Shared packs for all document types: Actor, Item, JournalEntry, RollTable, Macro, Scene, Cards.
- Per-world mirror pack creation.
- Bidirectional sync between mirror and shared, with change detection and conflict guards.
- **Initial adoption + merge** of the existing compendium content in both worlds (§4).
- Automatic per-world unlock, and keeping pack ownership in step between the two worlds (§5).
- Manifest-URL distribution: tagged GitHub releases publish `module.json` and `module.zip`.
- A GM-only manager application: pack status, last sync, dirty count, pending deletions.

### Out of scope (v1)
- Per-document change log / provenance UI (declined — §6.1 is the minimal bookkeeping sync requires).
- Backup/export snapshots.
- Support for any system other than `pf2e` (see §2.1).

### 2.1 System scoping — pf2e only
The module is explicitly scoped to **Pathfinder Second Edition on Foundry v14**, which
`.github/agents/developer.md` permits as named scoping. Concretely that means:

- `module.json` declares `relationships.systems: [{ id: "pf2e" }]` and `system: "pf2e"` on the
  Actor and Item packs. This also settles the open manifest question in §10.
- Startup refuses to run outside `pf2e` with one clear notification, instead of degrading
  feature by feature (§7.6).
- The README states pf2e-only support honestly rather than claiming untested systems.

What it does **not** change: the sync engine still copies whole documents and never reads
`actor.system` / `item.system` paths. There is nothing to gain from pf2e-specific data handling
here, and reaching into system data is how a sync tool corrupts a library. Duplicate detection
uses `_stats.compendiumSource`, a core Foundry field, not a pf2e one.

---

## 3. Architecture

```
compendium-manager/
├─ module.json
├─ README.md
├─ CHANGELOG.md
├─ LICENSE
├─ scripts/
│  ├─ module.js          lifecycle wiring (init / setup / ready)
│  ├─ constants.js       module id, pack definitions, flag scope
│  ├─ settings.js        game.settings registration
│  ├─ log.js             [compendium-manager] prefixed logging, debug gate
│  ├─ packs/
│  │  ├─ shared.js       resolve module packs, validate they exist
│  │  ├─ mirror.js       create/repair world mirror packs
│  │  └─ config.js       per-world lock + ownership configuration
│  ├─ sync/
│  │  ├─ engine.js       pull(), push(), reconcile()
│  │  ├─ revision.js     hashing + flag bookkeeping
│  │  ├─ folders.js      folder tree sync (keepId)
│  │  ├─ deletions.js    tombstone queue, GM confirmation
│  │  └─ watcher.js      document CUD hooks → debounced dirty queue
│  ├─ merge/
│  │  ├─ adopt.js        import a world compendium into the shared library
│  │  ├─ match.js        identity matching (id → compendiumSource → name+type)
│  │  └─ report.js       dry-run diff report model
│  └─ ui/
│     ├─ manager-app.js  ApplicationV2 + HandlebarsApplicationMixin
│     ├─ merge-app.js    adoption / merge wizard
│     └─ notify.js       ui.notifications helpers
├─ templates/
├─ styles/compendium-manager.css
├─ lang/en.json
└─ packs/                cm-actors, cm-items, cm-journals, cm-tables, cm-macros, cm-scenes, cm-cards
```

`scripts/systems/` is intentionally absent — there is no system-specific behaviour.

---

## 4. Initial adoption and merge

Both worlds already hold compendium content, and the same entry may exist in both with
**different ids** (created independently). Id equality alone is therefore not enough.

### 4.1 Matching ladder
For each incoming document, in order:
1. **Same `_id`** in the shared pack → same document lineage.
2. **Same `_stats.compendiumSource`** (v12+ core field; falls back to `flags.core.sourceId` if
   absent — feature-detected, not assumed) → both were dragged from the same pf2e source entry.
   This is the strongest signal for your library and is checked before names.
3. **Same document type + normalised name** (case- and whitespace-insensitive) → probable duplicate.
4. No match → new content.

### 4.2 Outcomes
| Case | Action |
|---|---|
| Match, hashes identical | skip |
| Match, hashes differ | **conflict** — listed for review: Keep shared / Take local / Keep both |
| Probable duplicate (rule 3) | listed for review, never auto-merged |
| New | import into shared with `keepId: true` |

### 4.3 Rules
- **Dry run first, always.** The wizard produces a report — counts and a per-document list of
  new / identical / conflicting / probable-duplicate — and writes nothing until you confirm.
- **Nothing is ever deleted** from either side during a merge.
- **Resumable and idempotent.** Re-running after a partial merge picks up where it stopped and
  produces no duplicates.
- Folder structure is recreated in the shared pack; colliding folder names are merged, not duplicated.

### 4.4 Sequence
1. In **Calamity**: adopt its compendiums → seeds the shared library (all "new").
2. In **Whispers**: adopt its compendiums → the interesting run, producing the conflict and
   duplicate lists you resolve.
3. Afterwards both worlds work through their mirror packs and the merge wizard is idle.

---

## 5. Player visibility — unchanged from stock Foundry

Compendium ownership in v14 is configured *per pack, per user role*
(`NONE` / `LIMITED` / `OBSERVER` / `OWNER`) via the pack's own configuration dialog. You keep
using exactly that. The module adds no sharing UI, no player tier, and no share flag.

The one thing it does do is stop you configuring it twice: **ownership is a world-scoped setting**,
so a pack you open to players in Calamity is still closed in Whispers. The module records each
managed pack's ownership in the meta document (which lives inside the shared pack and therefore
travels) and applies it on `ready` in the other world.

- Change ownership in either world through the normal Foundry dialog; the module notices and
  records it.
- Propagation is a setting (`syncPackOwnership`, default on). Turn it off and each world keeps
  its own ownership, with the module only ensuring packs are unlocked.
- The module never narrows ownership it did not previously widen, and never touches packs it
  does not manage.

---

## 6. Sync engine

### 6.1 Bookkeeping
Every managed document carries `flags.compendium-manager`:

| field | meaning |
|---|---|
| `rev` | integer, incremented on each successful push |
| `hash` | stable hash of the document source with its own flags removed |
| `world` | `game.world.id` of the world that last pushed it |
| `updatedAt` | epoch ms of last push |

Plus one meta document (`.cm-manifest`, a hidden JournalEntry in `cm-journals`) holding
`{ systemId, systemVersion, foundryVersion, lastWorld, lastSyncAt, packOwnership }`. It lives inside the pack
because Foundry module settings are world-scoped and would not travel between worlds.

### 6.2 Pull (shared → mirror), on `ready`
1. Index both packs via `getIndex({ fields: ["flags.compendium-manager"] })` — no full document loads.
2. Sync the folder tree first, `keepId: true`.
3. Per shared doc: missing in mirror → create; `hash` differs and mirror not dirty → update;
   both changed → conflict (§7.2).
4. Record `lastPulledRev` in a world-scoped internal setting.

### 6.3 Push (mirror → shared)
Triggered by the manual **Sync now** button and, when `autoSync` is on, a debounce (default 5 s)
after the last mirror write.
1. Per dirty uuid: recompute hash, skip if unchanged.
2. Create or update the shared doc with `keepId: true`; bump `rev`, stamp `world` / `updatedAt`.
3. Clear the dirty-queue entry only after the write resolves.

### 6.4 Change capture
Document CUD hooks fire for compendium documents with the pack reported in options. The watcher
filters to managed mirror packs, ignores writes the engine itself made (re-entrancy guard), and
appends uuids to a world-scoped dirty queue that survives reload.

### 6.5 Deletions — never automatic
Deleting from the mirror does **not** delete from shared; it enqueues a tombstone shown in the
manager UI for confirmation. A document present in shared but absent from the mirror is treated
as *not yet pulled*, not as deleted.

---

## 7. Data-safety rules

1. **`keepId: true` on every copy** — ids, and therefore UUIDs, stay stable across worlds.
2. **Conflict = keep shared, preserve local.** If a doc changed on both sides since the last common
   `rev`, the shared version wins in the mirror and the local version is copied into a `_conflicts`
   folder in the mirror pack. Nothing is destroyed; one notification is raised.
3. **No destructive write without confirmation** — deletions and bulk operations prompt with a summary.
4. **Minimal state** — the flags above plus the meta doc. Nothing is written into system data.
5. **Idempotent** — pull, push, and merge all change nothing on a second run.
6. **System guard** — the module refuses to initialise outside `pf2e`, and refuses to sync if the
   meta doc records a different `systemId` than the running world. A pf2e *version* difference
   between the two worlds warns but proceeds; keeping both worlds on the same pf2e version
   remains your responsibility.
7. **GM only** — all sync, merge, and configuration runs behind `game.user.isGM`.
8. **Never modify Foundry core or pf2e system files.** No file under the Foundry application
   directory, `Data/systems/pf2e/`, or any other package is created, edited, or deleted — not
   during install, not at runtime, not by the merge wizard. No core class is patched or
   monkey-patched; integration is through documented hooks and public document APIs only.
   pf2e's own compendiums are read-only sources: content dragged out of them is copied, and the
   originals are never written back to.

### What the module *does* write
Stated plainly, so rule 8 is not mistaken for "writes nothing outside itself":

| Location | Written? | What |
|---|---|---|
| `Data/modules/compendium-manager/packs/` | yes | the shared library — the module's own data |
| World database (mirror packs, folders, docs) | yes | created via `createCompendium` / document APIs |
| World `compendiumConfiguration` setting | yes | unlock + ownership of **managed packs only** |
| Foundry application files | **never** | — |
| `Data/systems/pf2e/**` | **never** | read-only source |
| Other modules' packs and files | **never** | — |
| Your existing world compendiums | read-only by default | only read during merge; the wizard copies out, never writes back or deletes |

---

## 8. Per-world pack configuration

Lock state and ownership live in the world-scoped `compendiumConfiguration` core setting
(`CompendiumCollection.CONFIG_SETTING`) — which is exactly why each world must be configured
separately. On `ready`, as GM, the module calls `pack.configure()` to ensure:

- Shared and mirror packs are `locked: false`, so you can edit them.
- Ownership matches whatever was last recorded in the meta doc, if `syncPackOwnership` is on (§5).

It writes only when the current value differs, so it is idempotent and does not fight manual changes.

---

## 9. Settings

| key | scope | default | purpose |
|---|---|---|---|
| `enabledTypes` | world | all | which document types are managed |
| `autoSync` | world | true | push automatically after edits |
| `syncDebounce` | world | 5 s | delay after last edit before pushing |
| `syncPackOwnership` | world | true | carry pack ownership across to the other world |
| `confirmDeletions` | world | true | require confirmation to delete from shared |
| `duplicateMatching` | world | source + name | matching ladder depth used by the merge wizard |
| `debug` | client | false | verbose `[compendium-manager]` logging |
| `dirtyQueue`, `lastPulledRev` | world, hidden | — | internal sync state |

---

## 10. v14 API verification

You cannot give me access to the install, so this is verified against the official v14 API
documentation. Confirmed (Foundry v14 stable, 14.359 April 2026 → 14.366):

| Need | Status |
|---|---|
| `CompendiumCollection.createCompendium(metadata, options)` | confirmed, static |
| `pack.configure(configuration)` | confirmed, instance |
| `CompendiumCollection.CONFIG_SETTING === "compendiumConfiguration"` | confirmed |
| `pack.locked`, `pack.ownership` accessors | confirmed |
| `getIndex({ fields })`, `getDocuments(query)`, `importDocument(doc)` | confirmed |
| Pack ownership is per-role, per-pack; **no per-document ownership** | confirmed — you keep using it as-is (§5) |

Still to confirm at M0, in Foundry itself rather than from docs:

- Whether module packs are GM-unlockable/writable at runtime in v14 (the whole plan rests on this —
  **verify at M1 before building anything else**).
- Exact `_stats.compendiumSource` presence in v14 pf2e documents (feature-detected either way).
- Which CUD hooks fire for compendium documents and how the pack is reported.

---

## 11. Milestones

| # | Deliverable | Verifiable by |
|---|---|---|
| M1 | Manifest + shared packs + per-world unlock/ownership | content saved in Calamity appears in Whispers, no mirror yet — **also proves module packs are writable** |
| M2 | Mirror pack creation + pull shared → mirror | mirror populated on first load in each world |
| M3 | Push mirror → shared with rev/hash, manual **Sync now** | edit in Calamity, switch to Whispers, edit present |
| M4 | Merge wizard: dry-run report, adoption, conflict resolution | Calamity seeds; Whispers merges with a reviewable diff |
| M5 | Auto-sync debounce, deletion queue, conflict handling | conflict produces `_conflicts` copy, no data loss |
| M6 | Manager UI, ownership propagation, localisation, README/CHANGELOG, test pass | full checklist below |

M1 is deliberately first and small: if module packs turn out not to be writable at runtime in v14,
the whole approach changes and I want to know that on day one, not at M4.

---

## 12. Test checklist (executed at M6)

1. Manifest valid; folder name matches `id`; loads in v14 with no console errors.
2. Round trip: create in Calamity → switch to Whispers → present, correct, editable → edit → back → present.
3. UUID stability: a journal link to a mirrored item resolves in both worlds.
4. Folder structure preserved in both directions.
5. Merge dry run reports accurate counts and writes nothing until confirmed.
6. Merge run twice → no duplicates, no re-listed conflicts.
7. Duplicate detection catches the same pf2e entry dragged into both worlds under different ids.
8. Repeat sync: two consecutive syncs produce zero writes.
9. Deletion in mirror does not remove shared content until confirmed.
10. Simulated conflict (edit shared pack directly while mirror dirty) → shared wins, local copy preserved.
10b. Enabling the module in a non-pf2e world (e.g. a Queens Blade world on another system) →
    refuses cleanly with one message, creates no packs.
11. Pack ownership set to OBSERVER in Calamity is in effect in Whispers after switching.
12. Non-GM user: no writes, no dialogs; sees exactly the packs their role allows.
13. Disable/re-enable module: mirror packs survive, no duplicate hooks.
14. Empty pack and large pack (500+ docs) — sync completes and reports progress.

Results will be reported honestly, separating what I ran from what you must run in Foundry.

---

## 13. Remaining risks

- **Module pack writability at runtime** — the load-bearing assumption. Tested first at M1.
- **Player visibility is all-or-nothing per pack**, as it is in stock Foundry. If you want a subset
  of a pack visible, that means splitting it into another pack — a manual choice, not something
  the module does for you.
- **Scenes** carry image paths; they are fine on one server with one data volume, but a scene
  referencing files under `worlds/<world>/` rather than a shared assets folder will break in the
  other world. The merge report flags such paths.
- **pf2e version drift** between worlds is warned about but not prevented.
- **No install access for me** means every Foundry-side behaviour is verified by you running it.
  Expect M1 and M2 to involve a short feedback loop with console output.

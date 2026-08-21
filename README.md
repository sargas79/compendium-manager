# Compendium Manager

Shares one compendium library between two Foundry VTT worlds on the same installation.

Built for a specific situation: two Pathfinder 2e worlds, one Foundry licence, only one world
running at a time. Content saved in one world is available in the other after switching.

- **Foundry:** v14
- **System:** Pathfinder Second Edition (`pf2e`) only
- **Audience:** GM. Players never trigger a sync and see only what pack ownership allows.

## How it works

Compendiums declared by a *module* live in `Data/modules/compendium-manager/packs/` and are
visible to every world that enables the module. World compendiums live inside the world folder
and cannot be shared. That is the whole sharing mechanism — the rest is bookkeeping.

You do not work in the module's packs directly. On first load in each world the module creates
**mirror packs** (`Shared Items (Shared Library)` and friends) as ordinary world compendiums.
You work in those; the module pulls the shared library into them at startup and pushes your
edits back after you make them.

Mirror packs are created with the same pack name in both worlds, so a document keeps the same
UUID (`Compendium.world.cm-items.Item.<id>`) everywhere. Links, macros, and actor references
written against the mirror survive the world switch.

## Installation

In Foundry: **Add-on Modules -> Install Module**, paste this manifest URL, and click Install:

```
https://github.com/sargas79/compendium-manager/releases/latest/download/module.json
```

That URL always points at the newest release, so Foundry's update check works from then on.
Install it once on the server, then enable the module in both worlds.

### Releasing a new version

Releases are built by GitHub Actions from a version tag. The tag is the source of truth for the
version number, so `module.json` does not need editing first:

```
git tag v0.1.0
git push origin v0.1.0
```

The workflow rewrites the version and download URL in `module.json`, verifies the manifest and
scripts, packages `module.zip`, and publishes both as release assets.

### Manual install (development)

Copy this folder into your Foundry user data directory as `Data/modules/compendium-manager`.
The folder name must match the module id exactly.

## First-time setup

1. Launch the world that should seed the library (the one with the content you trust most).
2. Enable the module. It creates the mirror packs and unlocks everything it manages.
3. Open **Compendium Manager** — from the compendium sidebar button, or
   *Configure Settings → Module Settings → Compendium Manager → Open Manager*.
4. Click **Merge a compendium**, choose one of your existing compendiums, and click
   **Analyse (dry run)**. Nothing is written yet.
5. Review the report, then **Apply**. Repeat per compendium.
6. Switch to the second world and repeat. This run is the interesting one: entries that already
   exist in the shared library are reported as identical, conflicting, or possible duplicates,
   and you decide what happens to each.

## Daily use

Drag content into the mirror packs and edit it there. With auto sync on (the default) your
changes are pushed a few seconds after your last edit. **Sync now** pushes and pulls immediately.

Before switching worlds, make sure the pending count in the manager is zero.

## Duplicate detection

The merge wizard matches incoming documents against the shared library in this order:

1. same document id;
2. same original compendium entry (`_stats.compendiumSource`) — the strongest signal for content
   dragged out of the pf2e system compendiums in both worlds;
3. same document type and name, ignoring case and extra spaces.

Only an id match is treated as the same document. Everything below that is *proposed* and waits
for your decision. The depth of the ladder is configurable.

## Safety

- Every copy keeps its document id, so UUIDs stay stable between worlds.
- **Conflicts keep the shared version** and copy your local version into a `_conflicts` folder in
  the mirror pack. Nothing is destroyed.
- **Deletions never propagate on their own.** Deleting from a mirror pack queues a tombstone in
  the manager; the shared copy is removed only after you confirm.
- The merge wizard always dry-runs first and never deletes from either side.
- Pull, push, and merge are idempotent: running them twice changes nothing the second time.
- The module refuses to run outside pf2e, and refuses to sync if the shared library records a
  different system than the running world.

### What it writes

| Location | Written? |
|---|---|
| `Data/modules/compendium-manager/packs/` | yes — its own shared library |
| World database (mirror packs, folders, documents) | yes — via public document APIs |
| World `compendiumConfiguration` setting | yes — unlock and ownership, for managed packs only |
| Foundry application files | **never** |
| `Data/systems/pf2e/**` | **never** — read-only source |
| Other modules' packs and files | **never** |
| Your existing world compendiums | read-only; the merge wizard copies out, never writes back |

No core class is patched or monkey-patched. Integration is through documented hooks and public
document APIs.

## Player visibility

Unchanged from stock Foundry: configure pack ownership per user role in the pack's own
configuration dialog. This module adds no sharing UI.

Because ownership is a *world* setting, a pack you open to players in one world is closed in the
other. With **Carry pack ownership between worlds** on (the default), the module records the
ownership you set and applies it in the other world. Turn it off and each world keeps its own.

## Settings

| Setting | Default | Effect |
|---|---|---|
| Sync automatically | on | push edits shortly after you make them |
| Auto sync delay | 5 s | how long to wait after your last edit |
| Carry pack ownership between worlds | on | apply one world's pack ownership in the other |
| Confirm deletions | on | ask before removing anything from the shared library |
| Duplicate detection | id + source + name | how hard the merge wizard looks for existing content |
| Debug logging | off | verbose `[compendium-manager]` console output |

Managed document types are toggled in the manager window.

## API

```js
const api = game.modules.get("compendium-manager").api;
await api.syncNow();          // push then pull
await api.push();             // local edits -> shared library
await api.pull();             // shared library -> local mirror
api.open();                   // manager window
api.openMergeWizard();
const report = await api.dryRun("world.my-old-items");
```

## Test checklist

Run these in Foundry; results are not claimed here (see *Status*).

1. Module loads in v14 with no console errors; folder name matches the module id.
2. Round trip: create in world A → switch to B → present and editable → edit → back to A.
3. A journal link to a mirrored item resolves in both worlds.
4. Folder structure is preserved in both directions.
5. Dry run reports accurate counts and writes nothing until confirmed.
6. Merge run twice → no duplicates.
7. Two consecutive syncs produce no writes.
8. Deleting in a mirror does not remove shared content until confirmed.
9. Editing the shared pack directly while the mirror is dirty → shared wins, local copy preserved
   in `_conflicts`.
10. Pack ownership set in one world is in effect in the other.
11. A non-GM user triggers no writes and sees only permitted packs.
12. Disable and re-enable the module: mirror packs survive, no duplicate hooks.
13. Enabling in a non-pf2e world: refuses cleanly, creates nothing.
14. A pack with 500+ documents syncs to completion.

## Status

Version 0.1.0. Written against the published Foundry v14 API documentation and syntax-checked,
but **not yet run inside Foundry**. Expect to work through the checklist above with the console
open; the load-bearing assumption to confirm first is that a GM can write to module packs at
runtime in v14 (test 1 and 2 cover it).

## Known limitations

- Both worlds must run the same system, and ideally the same pf2e version.
- Player visibility is per pack, not per entry — a Foundry constraint, not a module one.
- Scenes that reference images stored under `worlds/<world>/` will break in the other world;
  keep shared scene art in a common assets folder.
- Only one world may run at a time. This module does not make concurrent worlds safe.
- No backup/export tooling yet; back up your data directory before the first merge.

## Licence

See [LICENSE](LICENSE).

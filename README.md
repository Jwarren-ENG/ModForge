# ModForge AI

> Generate working Minecraft **Fabric** mods from a one-line idea.

ModForge AI is an agentic CLI that turns a natural-language mod idea into a compiled Fabric mod jar. Code is produced by **deterministic TypeScript templates**, with Claude used only for planning the mod spec. Every supported feature type (item, block, tool, weapon, recipe, command) goes through a template — there is no Claude codegen call on the happy path. AI codegen is reserved as a fallback for future feature types that don't yet have a template. Then it runs `gradle build` and uses an automatic repair loop to fix any compile errors that slip through.

This is **Milestone 1** — a local CLI prototype. The frontend, downloadable jar UI, templates library, and revision memory come in later milestones.

---

## Features

- Natural-language → structured `ModSpec` (JSON)
- Deterministic Fabric scaffold (`build.gradle`, `settings.gradle`, `gradle.properties`, `fabric.mod.json`, lang stub)
- AI-generated Java sources, item/block models, blockstates, recipes, lang entries
- Real Gradle build runner (`gradle build`)
- Automatic repair loop: feeds the build log + project files back to Claude to patch errors (configurable retry count)
- Preflight checks for JDK 17+ and Gradle with clear install hints
- Per-run timestamped workspace under `generated-projects/`
- Generated `README.md` and end-of-run summary

### Scope (MVP)

Supported feature types:

1. Simple **items**
2. Simple **blocks**
3. Basic **recipes** (shaped / shapeless)
4. Basic **tools / weapons**

**Out of scope** (the planning agent will refuse): multiplayer cheats, anti-cheat bypass, exploits on online servers, cracked-client features, injecting into closed-source / non-modded games. Forge, Quilt, NeoForge, mixins, Bedrock — all later.

---

## Local requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 18+ | Runs the CLI |
| JDK | **17+** (Temurin recommended) | Fabric Loom + Minecraft 1.20.1 require Java 17 |
| Gradle | **8.x** (recommend 8.8 or 8.10.2) — **NOT 9+** | Fabric Loom 1.6 is incompatible with Gradle 9+ |
| Anthropic API key | — | Set `ANTHROPIC_API_KEY` |

> **Why Gradle 8?** Our pinned stack uses Fabric Loom 1.6, which relies on Gradle internals that were removed in Gradle 9. A fresh `brew install gradle` today gives you 9.x and the build will fail. Use `gradle@8` or install Gradle 8 manually (see below). When we bump Loom (a future milestone) we can revisit this.
>
> **Tested versions:** Gradle **8.8** is verified working end-to-end (sapphire-block test). Gradle **9.5** is verified **failing** with Fabric Loom 1.6 — preflight blocks it before any build runs.

### macOS quick install (recommended: Homebrew)

> **SDKMAN is not recommended on macOS** — it requires Bash 4+, but macOS ships Bash 3.2. Use Homebrew or the manual install below.

```sh
brew install node
brew install --cask temurin@17

# If you previously installed Gradle (likely 9.x), remove it first:
brew uninstall gradle 2>/dev/null || true

# Install the Gradle 8 formula and force-link it as the active `gradle`:
brew install gradle@8
brew link --force --overwrite gradle@8
```

Verify:

```sh
gradle --version    # Gradle 8.x — must NOT be 9.x
java -version       # 17+
```

### macOS manual Gradle 8.8 install (fallback)

If `gradle@8` is not available in your Homebrew tap, or you prefer not to use Homebrew:

```sh
# 1. Download Gradle 8.8
curl -L -o /tmp/gradle-8.8-bin.zip https://services.gradle.org/distributions/gradle-8.8-bin.zip

# 2. Unzip into /opt
sudo mkdir -p /opt
sudo unzip -d /opt /tmp/gradle-8.8-bin.zip
# results in /opt/gradle-8.8/

# 3. Add to PATH (zsh — adjust for bash if needed)
echo 'export PATH=/opt/gradle-8.8/bin:$PATH' >> ~/.zshrc
source ~/.zshrc

# 4. Verify
gradle --version    # Gradle 8.8
```

To switch back later, remove the export line from `~/.zshrc`.

### Verify

```sh
node --version    # v18+
java -version     # 17+
gradle --version  # 8+
```

The CLI runs a preflight check on every invocation and prints fix-up instructions if any of these are missing.

> **Note on the first build:** the very first `gradle build` for a Fabric project downloads Minecraft, Yarn mappings, and Fabric API — expect several minutes and a few hundred MB of disk under `~/.gradle/caches/`. Subsequent builds are fast.

---

## Setup

```sh
git clone <this-repo> ModCraft
cd ModCraft
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _(required)_ | Claude API key |
| `MODFORGE_MODEL` | `claude-sonnet-4-6` | Model used for spec / codegen / repair |
| `MODFORGE_MAX_REPAIRS` | `3` | Max repair attempts after a failed build |
| `MODFORGE_WORKSPACE_DIR` | `./generated-projects` | Where mod projects are written |

---

## Usage

### Interactive

```sh
npm start
```

You'll be prompted for a mod idea, then the CLI walks through:

1. Preflight check (Java + Gradle)
2. Spec generation
3. Workspace creation
4. Fabric scaffolding
5. AI code generation
6. `gradle build` (with up to N repair attempts)
7. Artifact path + summary

### One-shot

```sh
npm start -- "A flaming emerald sword that deals extra damage to zombies and sets them on fire."
```

### Examples to try

```sh
# Verified end-to-end (now all template-only after Milestone 2.5):
npm start -- "Add a sapphire block with a crafting recipe."          # zero repairs
npm start -- "Add a copper hammer tool with high knockback."         # zero repairs
npm start -- "Add a simple command that gives the player a sapphire gem."  # zero repairs

# Milestone 2.6 — textures + retextures:
npm start -- "Add a void crystal item that is dark purple and glowing."
npm start -- "Add a bloodstone block that is dark red and metallic."
npm start -- "Retexture diamonds to look like black crystals."
npm start -- "Make grass blocks dark purple."

npm start -- "Add a glowing ruby ore block, a ruby item, and a recipe to craft 9 rubies into a ruby block."
npm start -- "Add a frost wand item that, when held, applies slowness to nearby zombies."  # may exceed MVP scope; the planner will narrow it
npm start -- "Add a recipe that turns 4 rotten flesh into 1 leather."
```

#### Verified successful runs

**1. Sapphire block** — `Add a sapphire block with a crafting recipe.`

Produced a buildable mod containing:

- `sapphire` — the gem item
- `sapphire_block` — the decorative / storage block
- 3×3 shaped recipe: 9 sapphires → 1 sapphire block
- Shapeless recipe: 1 sapphire block → 9 sapphires
- Mining tags so the block requires a (≥iron) pickaxe: `data/minecraft/tags/blocks/mineable/pickaxe.json` and `needs_iron_tool.json`
- Successful jar at `build/libs/sapphire_block_mod-1.0.0.jar`

Two repair-loop fixes from that run — drop `net.minecraft.block.Material`, drop `requiresCorrectToolForDrops()` and use `AbstractBlock.Settings.create()` + block tags instead — are now baked into the codegen prompt as 1.20.1 rules.

**2. Copper hammer** — `Add a copper hammer tool with high knockback.`

Produced a buildable mod containing:

- `copper_hammer` — custom melee weapon item with elevated knockback on hit
- Shaped recipe (copper ingots + stick, hammer-shaped)
- Working jar at `build/libs/copper_hammer-1.0.0.jar` (built via `gradle build`)

Three repair-loop fixes from that run — drop the bogus `net.minecraft.util.math.multiset.UnmodifiableIterator` reference, remove `@Override` annotations on methods that don't exist on the parent class for 1.20.1 Yarn, and use the correct attribute-modifier pattern — are now baked into the codegen prompt as tool/weapon rules. The repair loop only touched files under `src/main/java/`, confirming the safe-writer allowlist held.

**3. Command** — `Add a simple command that gives the player a sapphire gem.`

Produced a buildable mod containing:

- `sapphire` — the gem item (registered first, before the command)
- `/givesapphire` — server command at permission level 2 that gives the executing player one sapphire
- No recipe (none requested)
- Working jar at `build/libs/sapphire_gem_mod-1.0.0.jar`

**Built successfully on the first attempt** — 1 build, 0 repairs. The codegen prompt now includes a verified Fabric command pattern (CommandRegistrationCallback v2 + `CommandManager.literal` + `.requires(s -> s.hasPermissionLevel(2))` + `player.giveItemStack(...)` + `sendFeedback(Supplier, boolean)`) so future command prompts should follow the same first-try path.

With all three rule sets (block, tool/weapon, command) **baked into deterministic templates** (Milestone 2.5), future runs of these prompts skip AI codegen entirely and emit code that has already been verified to compile against MC 1.20.1 / Fabric Loom 1.6 — the AI codegen rule blocks remain in the system prompt as a safety net for any future feature type that falls back to the AI path.

**4. Grass-block retexture** — `Make grass blocks dark purple.`

Generated through the deterministic templates (`retexture_block` feature). Successful build with **0 repairs**. Output: two PNGs at `assets/minecraft/textures/block/grass_block_top.png` and `grass_block_side.png`, each rendered with the `grass` style. The `bottom` face is intentionally not retextured (it's dirt, not grass) — the planner now follows the explicit "Use `["all"]` for grass_block" rule, and a defensive normalizer strips `"bottom"` if a planner ever slips it in.

---

## Local web UI

A local web interface is available alongside the CLI. **The CLI remains the source of truth** — the web UI is a thin Express front-end that calls the same `runGeneration` core service the CLI uses, with no parallel logic or shortcuts. Schemas, safe writer, templates, and the repair loop are all unchanged.

The UI is a chat-style interface (Milestone 3.6 redesign): an empty hero with a prompt composer and example chips, a chat thread that maps real engine events to six friendly progress steps (Checking your Minecraft setup → Understanding your mod idea → Creating a clean mod project → Writing code and textures → Building the mod → Polishing the mod), and a result panel with a big **Download jar** button. Raw Gradle output is hidden in a collapsed "Show technical log" disclosure; project paths, file lists, repair history, and uncovered-features info are tucked into a collapsed "Advanced details" pane. No external CDN/font dependencies — fully local under the strict CSP.

### Run it

```sh
npm run web         # one-shot: tsx src/web/server.ts
npm run dev:web     # watch mode: tsx watch src/web/server.ts
```

The server binds to **`http://127.0.0.1:5173`** (loopback only — never `0.0.0.0`).

**Env variables:**

| Var | Default | Range | Effect |
| --- | --- | --- | --- |
| `MODFORGE_WEB_PORT` | `5173` | `1024..65535` | Listen port. Validated; invalid values exit on startup. |
| `MODFORGE_MAX_ACTIVE_JOBS` | `1` | `1..16` | Max simultaneous generation jobs. A second `POST /api/generate` while a job is running returns `429`. Default of `1` prevents a runaway local Gradle from spawning concurrent builds. |

> **`npm run build` does not produce a runnable web server.** The TypeScript build copies `.ts` to `dist/` but does not copy the static client (`index.html`, `app.js`, `styles.css`). Running `node dist/web/server.js` directly will exit with a clear error pointing you back to `npm run web`. The web UI is intentionally a source-only entry point for this milestone.

Open `http://127.0.0.1:5173` in a browser. The UI (Milestone 3.1) shows:

- A prompt textarea + an **example prompt gallery** (6 verified prompts as clickable cards with type tags)
- A **Generate** button that streams progress over Server-Sent Events
- A live timeline showing every `runGeneration` event (preflight, spec, scaffold, codegen with `templates` vs `AI fallback`, build, repair, stop, done, error)
- A collapsible Gradle build log (server-capped at 256 KiB; browser-capped at 200 K chars)
- A **result panel of cards** rendered on `done` / `error`:
  - **Build result** — success/fail, final reason, build + repair counts
  - **What to try next** — only on failure: last completed step + a context-specific suggestion
  - **Paths** — project folder + JAR with copy buttons
  - **Features** — every feature in the spec, with type, name, id, description
  - **Assumptions** / **Limitations** — only when the planner emitted them
  - **Uncovered features** — only when codegen fell back to AI for some types
  - **Generated files** — grouped into Java / Resources / Textures / Build artifact
  - **Texture previews** — pixelated 64×64 thumbnails of every PNG written by codegen, served via the index-based preview endpoint
  - **Repair history** — per-attempt build reason, duration, diagnosis, files changed, stop reason
  - **Local helpers** (Milestone 3.2) — three buttons in the **Paths** card: **Download jar** (streams via `/api/download/:jobId`), **Reveal jar** (opens the OS file manager and selects the jar via `/api/reveal/:jobId`), **Open project folder** (`/api/open/:jobId`). Buttons appear only after the job completes and only for the values the engine actually recorded — the client never constructs a path

### API surface

Three endpoints — and only three:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + capability probe; returns `{ status, jobs, activeJobs, maxActiveJobs, capabilities }`. The client uses `capabilities` to detect a stale server and warn the user to restart. |
| `POST` | `/api/generate` | Body `{ idea: string }` (≤ 2000 chars). Starts a generation; returns `{ jobId }` |
| `GET` | `/api/events/:jobId` | Server-Sent Events stream of `GenerationEvent`s. Replays buffered events on reconnect; closes when the job emits `done`/`error`. |
| `GET` | `/api/preview/:jobId/:index` | Returns a generated PNG by **job id + index into the per-job allowlist** of PNGs recorded at `codegen:done`. The client never sends a path. The server validates: job exists, index is in range, the stored relative path ends in `.png`, contains no `..`, and resolves inside the project workspace. |
| `GET` | `/api/download/:jobId` | Streams the built JAR as `application/java-archive` with a sanitized `Content-Disposition` filename. Refuses if the job is incomplete (`409`), has no `jarPath` (`404`), or if the recorded `jarPath` is outside the job's project workspace (`403`). |
| `POST` | `/api/open/:jobId` | Opens the job's project workspace in Finder/Explorer. Refuses if the job is incomplete (`409`) or the path no longer exists (`404`). |
| `POST` | `/api/reveal/:jobId` | Reveals the job's JAR in Finder/Explorer (macOS `open -R`, Windows `explorer /select,`, Linux falls back to opening the parent directory). Same guards as `/api/download/:jobId` for `jarPath` validity and workspace containment. |

Anything else under `/api/*` returns `404`. There is **no** endpoint that reads or writes arbitrary files. The only user input that crosses the network is the prompt string and the integer index used by `/api/preview/`. **All path-based helpers (`/download`, `/open`, `/reveal`) take only a `jobId`** — the server uses paths recorded by the engine and never accepts a path from the client.

### Example prompts (verified end-to-end via the UI)

```
Add a void crystal item that is dark purple and glowing.
Add a bloodstone block that is dark red and metallic.
Retexture diamonds to look like black crystals.
Add a copper hammer tool with high knockback.
```

### Server hardening

- **Active-job limit** (`MODFORGE_MAX_ACTIVE_JOBS`, default 1) prevents direct local POSTs from spawning concurrent Gradle builds. Excess requests return JSON `429`.
- **Per-job build-log byte cap** of 256 KiB (server) and 200 K chars (browser). When exceeded, a `[build log truncated]` marker is emitted and further chunks are dropped. `done`/`error` events are always retained and delivered.
- **JSON error middleware** ensures malformed JSON returns a JSON `400`, oversized bodies return a JSON `413`, and unexpected errors return a JSON `500` — never an Express HTML page.
- **Defense-in-depth headers**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a strict CSP (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`).
- **No file-path API** — there is no endpoint that reads or writes arbitrary paths. The texture preview endpoint accepts only `(jobId, integer index)` and reads from a per-job allowlist of PNG paths recorded at `codegen:done`; the resolved path is verified to live inside the job's project workspace before any read.
- **Local helpers (3.2)**: `/api/download/:jobId`, `/api/open/:jobId`, `/api/reveal/:jobId` accept **only a job id**. The server uses `job.projectPath` (recorded from the `workspace` event) and `job.jarPath` (recorded from `done.outcome.jarPath`) — both produced by the engine, never by the client. `download`/`reveal` re-verify that `jarPath` resolves inside `projectPath` before reading or revealing. `open`/`reveal` use `child_process.spawn` with the path as a single argv element (no shell), and the path itself is the recorded one — there is no way for a request to inject a different path. The launcher is overridable via `AppDeps.openInFinder` for tests so we never actually open a Finder window during CI.
- **Browser closes EventSource on `done`/`error`** so the auto-reconnect default doesn't keep a zombie stream alive.

### Limitations (intentional, for this milestone)

- Local-only. No accounts, sessions, or authentication. If you need multi-user, run the CLI.
- No database. Jobs live in memory; restarting the server clears them.
- No file picker, no file uploads, no cloud deployment, no publishing.
- No telemetry. The server makes the same Anthropic API call the CLI makes — and nothing else.
- Cosmetic only: the UI cannot bypass safe-writer rules, schema validation, deterministic templates, the repair loop, or the binary-write protections. If a generation succeeds in the UI, the same prompt would succeed via the CLI; the reverse is also true.

### CLI is still the source of truth

```sh
npm start -- "Add a void crystal item that is dark purple and glowing."
```

still works exactly as before. The web server only **adds** an HTTP entrypoint; it does not modify any existing code path.

---

## Output

Each run creates a timestamped project directory:

```
generated-projects/
  flaming_emerald_sword-2026-04-29T18-22-04-123Z/
    build.gradle
    settings.gradle
    gradle.properties
    src/main/java/com/modforge/flaming_emerald_sword/FlamingEmeraldSwordMod.java
    src/main/resources/fabric.mod.json
    src/main/resources/assets/flaming_emerald_sword/...
    src/main/resources/data/flaming_emerald_sword/...
    build/libs/flaming_emerald_sword-1.0.0.jar   # on success
    README.md                                    # on success
```

On success the CLI prints the jar path and install instructions. Drop the jar plus [Fabric API](https://modrinth.com/mod/fabric-api) into your Minecraft `mods/` folder.

> Generated mods now include **deterministic 16×16 PNG textures** when the spec sets `textureColor` on an item/block/tool/weapon, or when the prompt is a `retexture_item` / `retexture_block` against an allowlisted vanilla target. If the planner doesn't infer a color, the model JSON still references a `<modid>:item/<id>` or `<modid>:block/<id>` path; the mod will build and run, with that item/block appearing as the missing-texture placeholder in-game. Drop a PNG at the referenced path to fix, or re-run with a more visual prompt ("a dark purple glowing crystal item") so the planner picks colors.

---

## Architecture

```
src/
  cli.ts                         # thin renderer; calls runGeneration
  config.ts                      # env (validated) + pinned Fabric stack
  types.ts                       # BuildResult, RepairOutcome, RepairAttemptRecord, re-exports
  schemas.ts                     # zod: ModSpec / Codegen / Repair response schemas
  anthropic.ts                   # Claude client + (untyped) JSON extractor
  preflight.ts                   # JDK 17+ / Gradle 8.x checks (rejects Gradle 9+)

  core/
    runGeneration.ts             # headless service; emits typed events. CLI + future web UI both call this.

  generators/                    # deterministic TypeScript templates per feature type
    index.ts                     #   orchestrator: tryGenerateDeterministically(spec) -> files | uncovered
    item.ts, block.ts, toolWeapon.ts, recipe.ts, command.ts
    retextureItem.ts, retextureBlock.ts  # vanilla texture overrides (allowlisted only)
    mainClass.ts                 #   composes a single ModInitializer .java from merged contributions
    types.ts, utils.ts

  web/                           # local web UI (Phase 3) — Express + vanilla JS
    server.ts                    #   Express app: POST /api/generate, GET /api/events/:id (SSE), GET /api/health
    jobs.ts                      #   in-memory job store with TTL and event replay buffer
    client/
      index.html, app.js, styles.css  # static UI; no build step

  textures/                      # deterministic 16x16 PNG generation, no deps, no network
    png.ts                       #   PNG encoder: zlib + hand-rolled CRC32
    colors.ts                    #   hex parsing, shade/mix
    styles.ts                    #   procedural patterns: gem/crystal/metal/stone/grass/plain
    vanillaTargets.ts            #   allowlist of retexturable minecraft:* items + blocks
    index.ts                     #   generateTexturePng(opts) -> Buffer

  agent/
    createModSpec.ts             # idea -> ModSpec (zod-validated, typed details per feature type)
    generateModCode.ts           # AI fallback path (only used when a feature type has no template)
    repairBuild.ts               # build log + files -> patched files (zod-validated, safe-written)
    generateReadme.ts
    generateProjectSummary.ts

  workspace/
    createProjectWorkspace.ts    # timestamped per-run dir
    generateFabricProject.ts     # deterministic Fabric scaffold (LLM cannot touch these files)
    safeWrite.ts                 # phase-allowlisted writer w/ traversal + denylist guards
    packageSuccessfulBuild.ts    # locate built jar in build/libs

  build/
    runGradleBuild.ts            # spawn gradle: timeout + bounded logs + reason codes
    repairLoop.ts                # build -> repair -> rebuild, w/ progress detection + stop reasons
```

### Generation paths: templates (primary) vs AI fallback (exceptional)

**Templates are the primary path** for every currently supported feature type. AI codegen is **only** used when the orchestrator finds a feature it cannot template — a state that, today, the schema makes impossible: every type in the feature enum has a generator. The AI path remains wired in only so that adding a new feature type (mob / gui / dimension) doesn't require restructuring before the template exists.

The orchestrator (`src/generators/index.ts`) classifies each feature and picks the path:

| Feature type | Path | What it produces |
| --- | --- | --- |
| `item` | template | static field, registration, `models/item/<id>.json`, lang entry |
| `block` | template | block + blockitem fields, registrations, blockstate JSON, block model, item model, loot table, optional `mineable/*` and `needs_*_tool` tags, lang entry |
| `tool` / `weapon` | template | custom `Item` subclass file (`<Name>Item.java`) with safe `postHit` override using `MathHelper.sin/cos` + `takeKnockback`; field, registration, handheld item model, lang entry |
| `recipe` | template | `data/<modid>/recipes/<id>.json` (shaped or shapeless, vanilla 1.20 schema) |
| `command` | template | Fabric `CommandRegistrationCallback.EVENT.register(...)` block with `CommandManager.literal`, permission-level gate, item lookup via `Registries.ITEM.get(...)`, `player.giveItemStack`, `sendFeedback(Supplier, boolean)` |
| `retexture_item` | template | a single 16×16 PNG written **only** at the allowlisted vanilla item path (e.g. `assets/minecraft/textures/item/diamond.png`). No Java, no models. |
| `retexture_block` | template | one 16×16 PNG per requested face, written **only** at allowlisted vanilla block paths (e.g. `assets/minecraft/textures/block/grass_block_top.png`). |
| _(any feature type not in the above)_ | **AI fallback** | full LLM codegen of the project (current behavior) |

If **every** feature in the spec has a template — the case for every supported MVP mod — the deterministic path generates the entire mod and **no LLM call is made for codegen** (the planner is the only Claude call). If a future feature type is unsupported, or a generator unexpectedly throws on schema-valid input, the orchestrator records `uncoveredReasons` and falls back to full AI codegen for the whole spec. The orchestrator never crashes on a schema-valid spec; failures degrade to AI fallback rather than aborting the run.

Why this split:

- **Boilerplate** (build files, `fabric.mod.json`, lang stub, `.gitignore`) is templated by the scaffolder (`src/workspace/generateFabricProject.ts`). The LLM **cannot** modify these files (safe-writer denylist).
- **Common feature code** (everything in the table above) is templated by `src/generators/`. These templates encode every fix from the verified end-to-end runs — no `Material`, no `requiresCorrectToolForDrops`, no `multiset`, no blind `@Override`, correct `AbstractBlock.Settings.create()` usage, correct `CommandRegistrationCallback` v2 pattern, correct `sendFeedback` overload.
- **AI fallback** is reserved for unsupported feature types you might add later (mob, gui, dimension, animation). Today, every type in the schema enum has a template, so this path is dormant in practice — but it's wired through `runGeneration` so adding new feature types doesn't require restructuring.

The **safe writer** governs both paths identically: every file emitted by templates or AI must live under `src/main/java/**` or `src/main/resources/**`. Gradle and Fabric config files are off-limits to either path.

### Textures

Generated mods are visually meaningful — every `item` / `block` / `tool` / `weapon` feature with a `textureColor` (and optional `textureStyle`, `secondaryColor`, `glowing`) gets a deterministic 16×16 PNG written by `src/textures/`. **No external image AI**, no network calls — Node's built-in `zlib` + a hand-rolled CRC32 produce real PNG bytes from procedural pixel patterns.

**Styles:**

| Style | Looks like |
| --- | --- |
| `gem` | flat color with darker edge, top-left highlight, diagonal facet, white sparkle |
| `crystal` | tall vertical crystal cluster with optional glow halo (set `glowing: true`) |
| `metal` | horizontal banding with rivets, brighter mid-band |
| `stone` | speckled noise with a single darker "crack" line |
| `grass` | top face: speckled green; side face: grass band on dirt; bottom face: pure dirt |
| `plain` | flat fill with darker 1px border |

The same `(style, primaryColor, secondaryColor, faceMode, glowing)` tuple always produces byte-identical output (xorshift32 PRNG seeded from the color), so generated mods are reproducible.

### Vanilla retextures

Two new feature types — `retexture_item` and `retexture_block` — produce **resource-pack-style overrides** that replace vanilla textures by writing into `assets/minecraft/textures/...`. To prevent arbitrary-path writes from prompts, vanillaTargets are **allowlisted** in `src/textures/vanillaTargets.ts` (Milestone 3.7 broad coverage):

- **~95 vanilla items** — every weapon and tool material variant (`<material>_sword|pickaxe|axe|shovel|hoe`), full armor sets (`<material>_helmet|chestplate|leggings|boots`), common items (bow / crossbow / trident / fishing_rod / bucket / flint_and_steel / shears / book / writable_book / enchanted_book / map / name_tag / saddle), food and nature items, gems, ingots, etc.
- **~50 vanilla blocks** — natural blocks, all 8 standard ores + 8 deepslate variants, storage blocks for every metal/gem, all 8 wood logs (top + side faces) and planks
- **Tool silhouettes** — sword / pickaxe / axe / shovel / hoe each get a thin diagonal silhouette so a "make wooden sword red" retexture reads as a sword, not a square
- For multi-face blocks like `minecraft:grass_block`, only the allowed face names (`top`, `side`) can be requested

If the planner emits a `vanillaTarget` outside the allowlist, the spec is rejected at the schema layer **before** any generator runs — no path is ever constructed from raw user input. The generator looks up the allowed path by key and never concatenates user strings into a filesystem path.

**Vanilla retint** (Milestone 3.9): when `MODFORGE_VANILLA_ASSETS_DIR` points at an extracted copy of your Minecraft 1.20.1 textures, ModForge decodes the original PNG, recolors it via a continuous, luminance-preserving HSL transform (target hue, saturation blended with the source so neutral pixels stay neutral, source lightness preserved exactly), and re-encodes. Alpha is preserved byte-for-byte. Ore-style block targets (`*_ore`) get an additional chroma-weighted blend so stone background pixels stay stone-grey while the ore flecks recolor — `make diamond ore purple` keeps the cobble-style backdrop. The PNG decoder handles the color types Mojang ships in the 1.20.1 client jar (RGBA, RGB, paletted, grayscale, grayscale+alpha) so paletted textures like `diamond_sword.png` retint correctly.

**Procedural fallback**: when `MODFORGE_VANILLA_ASSETS_DIR` is unset, the source PNG is missing, or the decode fails, ModForge falls back to a procedurally-shaped silhouette (sword/pickaxe/axe/shovel/hoe/diamond/crystal-shard/ingot/generic-item) recolored with the spec's palette. The generated README records which textures used the fallback.

**Known limitations** (intentional):

- **Animated / multi-state items**: bow, crossbow, and fishing_rod each have multiple visual states (drawing animations, loaded/standby variants). The retexture writes only the **base/standby** texture — other animation frames keep the vanilla art. The README and the in-code allowlist comment call this out so users know to expect a partial visual change.
- **NOT allowlisted (no in-game effect from a flat PNG retexture)**: `minecraft:shield` (entity-backed model, no `textures/item/shield.png`), `minecraft:compass` (animated frames `compass_00..compass_31`), `minecraft:clock` (animated frames `clock_00..clock_63`). Asking for these will fail validation with the standard "not in the retexture allowlist" message — better than silently accepting a retexture that wouldn't show up in-game. Re-add when we model per-frame / entity-texture paths.

### Optional: use real vanilla textures for better retextures

Real vanilla retinting is supported and recommended. When `MODFORGE_VANILLA_ASSETS_DIR` points at an extracted copy of your Minecraft 1.20.1 textures, ModForge recolors Mojang's actual pixel art instead of the procedural fallback. To opt in, extract the textures from your own local Minecraft install:

> Mojang's textures are not redistributed. The extracted folder is gitignored (`vanilla-assets*/`). The extraction script reads from your own local launcher install only.

**1. Make sure you've launched Minecraft 1.20.1 at least once** (so the launcher has cached the version jar and asset index for that version on disk).

**2. Run the helper:**

```sh
npm run vanilla:extract
```

This script:

1. **Reads the version manifest** at `versions/1.20.1/1.20.1.json` to discover the launcher's `assetIndex.id` (modern installs use `"5"`).
2. **Prefers the client jar** at `versions/1.20.1/1.20.1.jar` (a ZIP) and pulls allowlisted texture entries directly out of it. This is where modern 1.20.1 keeps the block/item PNGs.
3. **Falls back to the asset index** at `assets/indexes/<assetIndex.id>.json` (and the content-addressed `assets/objects/<2>/<hash>` store) for any allowlisted path the jar doesn't contain.

Launcher root by OS:

- macOS: `~/Library/Application Support/minecraft/`
- Windows: `%APPDATA%\.minecraft\`
- Linux: `~/.minecraft/`

Allowlisted paths (~174 across items + blocks) land in:

```
./vanilla-assets-1.20.1/assets/minecraft/textures/{item,block}/...
```

Every write is guarded by a path-containment check (`validateVanillaTexturePath`) — paths must be relative, free of `..`, end in `.png`, and live under `assets/minecraft/textures/{item,block}/`. The script logs `(N from jar, M from asset index)` and lists anything missing.

**3. Point ModForge at the extracted directory:**

```sh
export MODFORGE_VANILLA_ASSETS_DIR="$(pwd)/vanilla-assets-1.20.1"
```

(Add to `.env` if you want it persistent.)

**4. Re-run** `npm run web` (or the CLI). Now "make wooden sword red" decodes the real `wooden_sword.png` and applies the luminance-preserving HSL recolor, keeping Mojang's shape, shading, and alpha intact.

If the env var is unset, the source file is missing, or the source PNG can't be decoded (corrupt / unsupported color type), ModForge falls back to procedural texture generation and the generated `README.md` records which textures used the fallback.

### Repair loop

1. Run `gradle build`, capture stdout/stderr (each stream bounded at 1 MiB; excess is dropped with a `[truncated: N bytes]` marker).
2. If exit code != 0: collect every file under `src/main/java` and `src/main/resources`, send them along with the (truncated) build log to Claude.
3. Claude returns full replacement contents for the subset of files that need to change. The response is validated against a zod schema; only changed files (by content diff) are actually written.
4. Write those files via the **safe writer** (see safety model). Rebuild.
5. Stop early on any of:
   - `success` — exit 0
   - `max-repairs` — `MODFORGE_MAX_REPAIRS` reached
   - `no-changes` — repair returned zero changed files
   - `no-progress` — identical error signature as the previous attempt
   - `timeout` — gradle exceeded the build timeout (no repair attempted; not a code-fix problem)
   - `spawn-failed` — gradle could not be launched (no repair attempted)

The full attempt history (build reason, duration, diagnosis, files changed, stop reason) is included in the end-of-run summary so failures are debuggable without re-running.

---

## Safety model

LLM output is treated as **untrusted input**. Two layers protect the project:

### 1. Schema validation (zod)

Every JSON response from Claude is parsed by [zod](https://zod.dev/) before any field is used:

| Phase | Schema | Rejects |
| --- | --- | --- |
| `createModSpec` | `ModSpecSchema` | See below — covers id/loader/package/class/version, typed details, cross-feature checks |
| `generateModCode` | `CodegenResponseSchema` | Missing `files` array, empty file list, missing `path` / `content` |
| `repairBuild` | `RepairResponseSchema` | Missing `files` array, malformed file entries |

`ModSpecSchema` is strict at every level:

- **Per-type details are `.strict()`** — any field not listed in the per-type schema is rejected. The planner cannot smuggle in `category`, `tier`, `tooltip`, etc.
- **Recipes are a discriminated union** on `shape`: shaped recipes require `pattern` (1-3 rows, equal width), single-character `key` entries, every non-space pattern char defined in key, and no unused keys; shapeless recipes require non-empty `ingredients`.
- **Cross-feature checks (`superRefine`)**:
  - `feature.id` values must be unique across the spec
  - `command.details.commandName` values must be unique
  - Generated Java class names must not collide (mainClass + `<PascalCase(toolId)>Item` for tool/weapon features)
  - Java package segments and class names must not be reserved words (`class`, `new`, `void`, ...)
  - `modVersion` must look like `1.2.3` or `1.2.3-beta.1` (no `1.0`, `v1`, `next`)
  - Item references in recipes / commands that point at the mod's own namespace must reference a declared `item`/`block`/`tool`/`weapon` feature (BlockItems are valid; `#tag` refs are exempt; `minecraft:*` refs are exempt)

A schema failure aborts the run with an actionable message listing every violated path (e.g. `features.2.details.key: pattern uses 'X' but it is not defined in key`).

### 2. Safe file writer (phase allowlists)

`generateModCode` and `repairBuild` write through `safeWriteFiles` (`src/workspace/safeWrite.ts`), which enforces a project-relative allowlist:

```
ALLOW: src/main/java/**, src/main/resources/**
DENY:  fabric.mod.json (anywhere, by basename),
       build.gradle, settings.gradle, gradle.properties (and .kts variants),
       package.json, package-lock.json, tsconfig.json, .env, .env.local, .npmrc,
       absolute paths, paths with `..`, anything outside the project directory.
```

Validation happens **before any file is written** — if any path in a batch fails, the **entire batch is rejected** (no partial writes). The Gradle / Fabric boilerplate (`build.gradle`, `settings.gradle`, `gradle.properties`, `fabric.mod.json`) is written **only by deterministic TypeScript templates** in `generateFabricProject.ts`. Neither AI codegen nor the AI repair path can touch it. This is covered by tests in `tests/safeWrite.test.ts`.

### 3. Bounded subprocesses

`runGradleBuild`:
- 30-minute default timeout (configurable per call), SIGTERM then SIGKILL after a 5s grace period.
- 1 MiB cap per stdout/stderr stream — excess is dropped, not buffered into memory.
- Distinct outcome codes: `success`, `build-failed`, `timeout`, `spawn-failed`. The repair loop only invokes the LLM for `build-failed` — `timeout` and `spawn-failed` exit immediately because they aren't compile errors.

### 4. Refusal in the planning prompt

`createModSpec`'s system prompt refuses out-of-scope features (multiplayer cheats, anti-cheat bypass, online-server exploits, cracked-client features, closed-source-game injection) before any code is generated.

---

## Debugging

**A run failed — what do I look at?**

1. The end-of-run summary prints the full repair history with diagnoses, files changed, and stop reason.
2. The generated project is left on disk at `generated-projects/<modid>-<timestamp>/`. Open it in your IDE and run `gradle build` directly to reproduce.
3. Check the Gradle build log under `<project>/build/reports/`.

**Common stop reasons:**

| Stop reason | What it means | What to do |
| --- | --- | --- |
| `no-progress` | Same error signature two attempts in a row | Re-run with a more constrained idea; the LLM is stuck. |
| `no-changes` | Repair returned zero changed files | The LLM thinks the build is already correct. Inspect the project manually. |
| `max-repairs` | Hit `MODFORGE_MAX_REPAIRS` | Bump `MODFORGE_MAX_REPAIRS=5` and retry, or fix manually. |
| `timeout` | First Loom build can take many minutes | Increase the timeout, or retry — Gradle's caches will be warm on the second attempt. |
| `spawn-failed` | `gradle` not on PATH | `brew install gradle@8 && brew link --force --overwrite gradle@8`, then re-run. |

**Reproduce the build manually:**

```sh
cd generated-projects/<modid>-<timestamp>
gradle build --info
```

**Inspect what the LLM proposed:**

The repair loop logs its diagnosis and changed-file list per attempt. To see Claude's raw JSON, set `DEBUG=1` and re-run (TODO: not yet implemented; for now, run the generated project's build manually).

---

## Tests

```sh
npm test          # node:test runner via tsx
npm run typecheck # src + tests
```

The test suite covers the safety-critical surface:

- `tests/safeWrite.test.ts` — `fabric.mod.json` / `build.gradle` / `settings.gradle` / `gradle.properties` / `package.json` / `tsconfig.json` / `.env` denied at any path; absolute paths and `..` traversal denied; allowlisted Java + resources paths accepted; batch-atomic (one bad path rejects the whole batch).
- `tests/schemas.test.ts` — duplicate feature ids, duplicate command names, all four bad-shaped-recipe shapes (unused key / missing key char / multi-char key / inconsistent widths), empty shapeless ingredients, missing local item refs (recipe + command), tag-ref + `minecraft:*` refs allowed, Java reserved words in package, bad `modVersion` strings, strict `details` (extra fields rejected), tool-class collision with `mainClass`, valid sapphire spec passes.
- `tests/generators.test.ts` — every feature type produces the expected files, shaped/shapeless recipes emit valid 1.20 vanilla schema, weapon emits exactly one `@Override` (no invented ones), command block emits the verified Fabric pattern (`CommandRegistrationCallback`, `getPlayerOrThrow`, `sendFeedback(Supplier, boolean)`), and **no Gradle/Fabric/package config files are ever produced by templates**.
- `tests/textures.test.ts` — PNG encoder produces valid signature + IHDR + IEND, every style produces a 16×16 PNG, output is deterministic for fixed inputs, bad hex colors are rejected, grass side face differs from grass top.
- `tests/retexture.test.ts` — retexture_item writes to allowlisted vanilla path, non-allowlisted target fails schema validation, traversal-style targets fail validation, `grass_block` retexture produces both top and side PNGs, `grass_block faces=['all']` expands correctly without throwing, simple block retexture produces a single PNG, requesting a disallowed face (e.g. `bottom` for grass) fails validation, retexture output paths never escape `assets/minecraft/textures/{item,block}/`, original item/block textures end up under the mod's namespace, the three baseline regression prompts still produce `fullyCovered` specs, and duplicate retexture targets/faces fail schema validation.
- `tests/repairBinary.test.ts` — repair-time binary path filter rejects `.png`/`.jpg`/`.ogg`/`.jar`/etc, allows text files, and matches case-insensitively.
- `tests/web.test.ts` — `/api/health` returns ok, `/api/generate` rejects empty / malformed JSON / oversized body with JSON errors (not HTML), unknown `/api/*` returns JSON 404, SSE 404 for unknown jobs, SSE replay delivers buffered events, active-job limit returns JSON 429, response headers include `nosniff` + strict CSP, **`/api/preview/:jobId/:index`** serves an allowlisted PNG and returns 404 for unknown job / out-of-range index / no-workspace state, returns 400 for non-integer index, and cannot be tricked into serving non-PNG paths via a fabricated `codegen:done` event. **`/api/download/:jobId`** serves the JAR with proper headers, returns 404 for unknown job / no-jar / failed build, 409 for incomplete jobs, and 403 if a recorded `jarPath` escapes the workspace. **`/api/open/:jobId`** and **`/api/reveal/:jobId`** invoke a stubbed opener with the recorded paths, refuse incomplete jobs (409), refuse jars outside the workspace (403), and a final test verifies that even URL-encoded path-shaped jobIds are treated as opaque ids (404). **`/api/health` advertises every helper capability** so the UI can detect a stale server. **End-to-end round-trip test** confirms the `jobId` returned by `/api/generate` is the exact id accepted by `/api/download`, `/api/reveal`, and `/api/open` for a successful build, with the opener called with the same `projectPath` / `jarPath` recorded by the engine. All tests use a stubbed `runGeneration` and a stubbed opener, so they never call the Anthropic API, run Gradle, or open a Finder window.

## Pinned Fabric stack

The MVP locks to a known-good combo (set in `src/config.ts`):

- Minecraft `1.20.1`
- Yarn mappings `1.20.1+build.10`
- Fabric Loader `0.15.11`
- Fabric API `0.92.2+1.20.1`
- Loom `1.6-SNAPSHOT`
- Java `17`

Bumping these is a future milestone; for now keep them pinned so codegen and repair stay reliable.

---

## Troubleshooting

**"JDK is not installed or not on PATH."** — Install Temurin 17 and reopen your shell. On macOS: `brew install --cask temurin@17`.

**"Gradle is not installed or not on PATH."** — `brew install gradle@8 && brew link --force --overwrite gradle@8`. Do **not** install plain `gradle` (it's 9.x and Loom 1.6 won't work).

**"Fabric Loom 1.6 is not compatible with Gradle 9+."** — You have Gradle 9.x. Run `brew uninstall gradle && brew install gradle@8 && brew link --force --overwrite gradle@8`, or use the manual Gradle 8.8 install above.

**Don't use SDKMAN on macOS.** It requires Bash 4+ but macOS ships Bash 3.2; setup will fail. Use Homebrew or the manual install.

**The first build hangs for minutes.** — Expected. Loom is downloading Minecraft, mappings, and Fabric API on the first run. Watch `~/.gradle/caches/fabric-loom`.

**Build keeps failing after 3 repair attempts.** — Re-run with a more constrained idea, or open the generated project and inspect the last `build/` log. You can bump `MODFORGE_MAX_REPAIRS` for harder mods.

**Items / blocks appear as purple-and-black checkers in-game.** — The planner didn't set `textureColor` on that feature, so no PNG was generated. Re-run with a more descriptive prompt (mention a color or material — "a dark red metallic block", "a glowing purple crystal"), or drop a PNG manually at the asset path the model JSON references.

**"Download jar fails with 'File wasn't available on site'", or "Reveal jar / Open project folder returns Failed 404: not found".** — The local web server is **out of date**. You edited the source (or pulled new code) and the running `npm run web` process hasn't picked up the new helper endpoints. The browser sees the buttons because the static client reloaded, but the API server still routes `/api/download/*`, `/api/reveal/*`, `/api/open/*` to the catch-all `404 not found`. **Stop and restart `npm run web`.** The UI now does a capability check on page load and surfaces a clear "⚠ Server is out of date — restart `npm run web`" banner when the running server lacks the helper endpoints; if the helpers themselves return `404 not found` (the catch-all body), the button label switches to `Server stale — restart npm run web` instead of a generic error.

---

## Roadmap

- [x] Milestone 1 — Local CLI prototype (this)
- [ ] Milestone 2 — Smarter repair (multi-file diffs, mapping-aware lookups)
- [x] Milestone 3 — Local web frontend with status timeline (this)
- [ ] Milestone 4 — One-click jar download
- [ ] Milestone 5 — Reusable mod templates (item / block / recipe / tool)
- [ ] Milestone 6 — Project memory + revisions (“make the sword stronger and add a lightning effect”)

---

## License

MIT (the generator). Generated mods are yours.

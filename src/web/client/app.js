// @ts-check
// ModForge AI · local web UI · vanilla JS, no build step.

const EXAMPLES = [
  { prompt: "Add a void crystal item that is dark purple and glowing.", tag: "item · texture" },
  { prompt: "Add a bloodstone block that is dark red and metallic.",     tag: "block · texture" },
  { prompt: "Retexture diamonds to look like black crystals.",           tag: "retexture" },
  { prompt: "Make grass blocks dark purple.",                            tag: "retexture" },
  { prompt: "Add a copper hammer tool with high knockback.",             tag: "weapon" },
  { prompt: "Add a simple command that gives the player a sapphire gem.", tag: "command" },
];

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {EventSource | null} */
let currentSource = null;
/** @type {string | null} */
let currentJobId = null;
/** @type {any} */
let lastSpec = null;
/** @type {string[]} */
let lastUncoveredReasons = [];
/** @type {string[]} */
let lastWritten = [];
/** @type {string} */
let lastCompletedStep = "(none)";

const MAX_CLIENT_LOG_CHARS = 200_000;
const TRUNCATION_NOTE_CLIENT = "[earlier build log truncated by browser]\n";

/**
 * Capabilities the UI expects from the server. If the running server is out
 * of date (e.g. user forgot to restart `npm run web`), some of these will be
 * missing and the helper buttons would 404 mysteriously. We surface that as
 * a banner instead.
 */
const REQUIRED_CAPABILITIES = ["generate", "events", "open", "reveal", "download"];
/** @type {Set<string>} */
let serverCapabilities = new Set();

function init() {
  const ex = $("examples");
  for (const item of EXAMPLES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "example-card";
    card.innerHTML =
      `<span class="example-tag">${escapeHtml(item.tag)}</span>` +
      `<span class="example-text">${escapeHtml(item.prompt)}</span>`;
    card.addEventListener("click", () => {
      /** @type {HTMLTextAreaElement} */ ($("idea")).value = item.prompt;
    });
    ex.appendChild(card);
  }
  $("generate").addEventListener("click", startGeneration);

  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => {
      const caps = Array.isArray(j.capabilities) ? j.capabilities : [];
      serverCapabilities = new Set(caps);
      const missing = REQUIRED_CAPABILITIES.filter((c) => !serverCapabilities.has(c));
      if (missing.length > 0) {
        $("apiNote").innerHTML =
          `<span class="warn">⚠ Server is out of date — missing endpoints: ${missing
            .map((m) => escapeHtml(m))
            .join(", ")}. Restart with <code>npm run web</code>.</span>`;
      } else {
        $("apiNote").textContent = `API ok · ${j.activeJobs}/${j.maxActiveJobs} active`;
      }
    })
    .catch(() => { $("apiNote").textContent = "API unreachable."; });
}

async function startGeneration() {
  const idea = /** @type {HTMLTextAreaElement} */ ($("idea")).value.trim();
  if (idea.length === 0) return;

  /** @type {HTMLButtonElement} */ ($("generate")).disabled = true;
  $("status").hidden = false;
  $("output").hidden = true;
  $("timeline").innerHTML = "";
  $("buildLog").textContent = "";
  $("cards").innerHTML = "";
  lastSpec = null;
  lastUncoveredReasons = [];
  lastWritten = [];
  lastCompletedStep = "(none)";

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    });
  } catch (e) {
    addLine("error", "Network error: " + (e instanceof Error ? e.message : String(e)));
    renderFailureCard({ error: "Network error reaching the local API." });
    finalizeRun();
    return;
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error ?? ""; } catch { /* */ }
    addLine("error", `API error (${res.status}): ${detail}`);
    renderFailureCard({ error: `API error (${res.status}): ${detail}` });
    finalizeRun();
    return;
  }
  const { jobId } = await res.json();
  currentJobId = jobId;
  addLine("info", `Job started: ${jobId}`);

  if (currentSource) currentSource.close();
  const ev = new EventSource(`/api/events/${encodeURIComponent(jobId)}`);
  currentSource = ev;
  ev.addEventListener("message", (m) => {
    try { handleEvent(JSON.parse(m.data)); }
    catch (err) { console.error("bad event payload", err); }
  });
  ev.addEventListener("error", () => {
    if (ev.readyState === EventSource.CLOSED) finalizeRun();
  });
}

/** @param {any} e */
function handleEvent(e) {
  switch (e.type) {
    case "phase":
      lastCompletedStep = e.message;
      addLine("phase", `▶ ${e.message}`);
      break;
    case "preflight":
      if (e.result.ok) {
        addLine("ok", `✓ Preflight ok (Java v${e.result.java.version}, Gradle ${e.result.gradle.version ?? "?"})`);
      } else {
        addLine("fail", `✗ Preflight failed: ${e.result.problems.join("; ")}`);
      }
      break;
    case "spec":
      lastSpec = e.spec;
      addLine("info", `Spec: ${e.spec.modName} (${e.spec.modId}) — ${e.spec.features.length} feature(s)`);
      break;
    case "workspace":
      addLine("info", `Workspace: ${e.projectPath}`);
      break;
    case "scaffold:done":
      addLine("ok", "✓ Scaffold complete");
      break;
    case "codegen:done": {
      const src = e.source === "templates" ? "deterministic templates" : "AI fallback";
      addLine("ok", `✓ Codegen wrote ${e.written.length} file(s) via ${src}`);
      lastWritten = Array.isArray(e.written) ? e.written.slice() : [];
      lastUncoveredReasons = Array.isArray(e.uncoveredReasons) ? e.uncoveredReasons.slice() : [];
      for (const r of lastUncoveredReasons) addLine("info", `  uncovered: ${r}`);
      break;
    }
    case "build:start":
      addLine("phase", `▶ Build attempt ${e.attempt}`);
      break;
    case "build:chunk":
      appendBuildLog(e.chunk);
      break;
    case "build:result": {
      const ok = e.result.success;
      const dur = (e.result.durationMs / 1000).toFixed(1);
      addLine(ok ? "ok" : "fail", `${ok ? "✓" : "✗"} Build ${e.attempt}: ${e.result.reason} (${dur}s)`);
      break;
    }
    case "repair:start":
      addLine("phase", `▶ Repair attempt ${e.attempt}`);
      break;
    case "repair:done":
      addLine("info", `  diagnosis: ${e.diagnosis ?? "(no diagnosis)"}`);
      addLine("info", `  files changed: ${(e.filesChanged || []).join(", ") || "(none)"}`);
      break;
    case "stop":
      addLine("info", `■ Stop: ${e.reason}`);
      break;
    case "done":
      renderResultCards(e);
      finalizeRun();
      break;
    case "error":
      addLine("error", `Error: ${e.error}`);
      renderFailureCard({ error: e.error });
      finalizeRun();
      break;
  }
  const tl = $("timeline");
  tl.scrollTop = tl.scrollHeight;
}

/** @param {string} chunk */
function appendBuildLog(chunk) {
  const log = $("buildLog");
  let next = log.textContent + chunk;
  if (next.length > MAX_CLIENT_LOG_CHARS) {
    const keep = MAX_CLIENT_LOG_CHARS - TRUNCATION_NOTE_CLIENT.length;
    next = TRUNCATION_NOTE_CLIENT + next.slice(next.length - keep);
  }
  log.textContent = next;
  log.scrollTop = log.scrollHeight;
}

function finalizeRun() {
  if (currentSource) {
    try { currentSource.close(); } catch { /* */ }
    currentSource = null;
  }
  /** @type {HTMLButtonElement} */ ($("generate")).disabled = false;
}

/** @param {string} kind  @param {string} text */
function addLine(kind, text) {
  const li = document.createElement("li");
  li.className = `line line--${kind}`;
  li.textContent = text;
  $("timeline").appendChild(li);
}

// =================== result rendering ===================

/** @param {any} e */
function renderResultCards(e) {
  $("output").hidden = false;
  const cards = $("cards");
  cards.innerHTML = "";
  const o = e.outcome;
  const ok = o.success;

  // Build status card.
  cards.appendChild(buildStatusCard(o, ok));

  if (!ok) {
    cards.appendChild(failureSuggestionCard(`Build failed: ${o.finalReason}`));
  }

  // Paths card.
  cards.appendChild(pathsCard(e.projectPath, ok ? o.jarPath : undefined));

  // Features / assumptions / limitations / uncovered (from spec).
  if (lastSpec) {
    if (Array.isArray(lastSpec.features) && lastSpec.features.length > 0) {
      cards.appendChild(featuresCard(lastSpec.features));
    }
    if (Array.isArray(lastSpec.assumptions) && lastSpec.assumptions.length > 0) {
      cards.appendChild(listCard("Assumptions", lastSpec.assumptions));
    }
    if (Array.isArray(lastSpec.limitations) && lastSpec.limitations.length > 0) {
      cards.appendChild(listCard("Limitations", lastSpec.limitations));
    }
  }
  if (lastUncoveredReasons.length > 0) {
    cards.appendChild(listCard("Uncovered features (forced AI fallback)", lastUncoveredReasons));
  }

  // Generated files.
  if (lastWritten.length > 0 || (ok && o.jarPath)) {
    cards.appendChild(filesCard(lastWritten, ok ? o.jarPath : undefined));
  }

  // Texture previews.
  const pngs = lastWritten.filter((p) => p.toLowerCase().endsWith(".png"));
  if (pngs.length > 0 && currentJobId) {
    cards.appendChild(texturesCard(currentJobId, pngs));
  }

  // Repair history.
  if (Array.isArray(o.history) && o.history.length > 0) {
    cards.appendChild(historyCard(o.history));
  }

  wireCopyButtons();
}

/** @param {{ error: string }} info */
function renderFailureCard(info) {
  $("output").hidden = false;
  const cards = $("cards");
  cards.innerHTML = "";
  cards.appendChild(makeCard("Generation failed", `<p class="status fail"><strong>${escapeHtml(info.error)}</strong></p>`));
  cards.appendChild(failureSuggestionCard(info.error));
  if (lastSpec && Array.isArray(lastSpec.features) && lastSpec.features.length > 0) {
    cards.appendChild(featuresCard(lastSpec.features));
  }
}

/** @param {any} o  @param {boolean} ok */
function buildStatusCard(o, ok) {
  const html =
    `<p class="status ${ok ? "ok" : "fail"}">` +
    `Build: <strong>${ok ? "SUCCESS" : "FAILED"}</strong> — ` +
    `<code>${escapeHtml(o.finalReason)}</code> ` +
    `(${o.buildAttempts} build${o.buildAttempts === 1 ? "" : "s"}, ` +
    `${o.repairAttempts} repair${o.repairAttempts === 1 ? "" : "s"})</p>`;
  return makeCard(ok ? "Build result" : "Build result (failed)", html);
}

/** @param {string} reason */
function failureSuggestionCard(reason) {
  const lower = reason.toLowerCase();
  let suggestion;
  if (lower.includes("preflight")) {
    suggestion = "Install JDK 17+ and Gradle 8.x (not 9.x), then re-run.";
  } else if (lower.includes("timeout")) {
    suggestion = "The build exceeded the timeout. Try again — the second run is faster because Gradle's cache is warm.";
  } else if (lower.includes("max-repairs") || lower.includes("no-progress") || lower.includes("no-changes")) {
    suggestion = "The repair loop couldn't fix the build. Try a simpler prompt — for example, ask for one item or one block at a time.";
  } else if (lower.includes("validation") || lower.includes("schema")) {
    suggestion = "The planner produced a spec that didn't match the schema. Try a more concrete prompt with explicit colors or feature names.";
  } else {
    suggestion = "Try again with a simpler prompt, or pick one of the example prompts above.";
  }
  const html =
    `<p><strong>Last completed step:</strong> ${escapeHtml(lastCompletedStep)}</p>` +
    `<p><strong>Suggestion:</strong> ${escapeHtml(suggestion)}</p>`;
  return makeCard("What to try next", html);
}

/** @param {string} projectPath  @param {string | undefined} jarPath */
function pathsCard(projectPath, jarPath) {
  const rows = [renderCopyRow("Project folder", projectPath)];
  if (jarPath) rows.push(renderCopyRow("JAR artifact", jarPath));

  const id = currentJobId ?? "";
  const buttons = [];

  if (!id) {
    // Sanity guard: if we somehow lost the job id, do NOT issue helper requests
    // with an empty id. Show a clear, disabled affordance instead.
    buttons.push(
      `<span class="action disabled" title="Re-run generation">job id missing — re-run</span>`,
    );
  } else {
    if (jarPath) {
      const dlHref = `/api/download/${encodeURIComponent(id)}`;
      const safeJar = jarPath.split("/").pop() ?? "mod.jar";
      buttons.push(
        `<a class="action" href="${escapeAttr(dlHref)}" download="${escapeAttr(safeJar)}">⬇ Download jar</a>`,
        `<button class="action" type="button" data-finder="reveal" data-job="${escapeAttr(id)}">📂 Reveal jar</button>`,
      );
    }
    buttons.push(
      `<button class="action" type="button" data-finder="open" data-job="${escapeAttr(id)}">🗂 Open project folder</button>`,
    );
  }
  return makeCard("Paths", rows.join("") + `<div class="action-row">${buttons.join("")}</div>`);
}

/** @param {any[]} features */
function featuresCard(features) {
  const items = features
    .map(
      (f) =>
        `<li><span class="ftype">${escapeHtml(f.type)}</span>` +
        `<strong>${escapeHtml(f.name)}</strong> ` +
        `<span class="muted">(${escapeHtml(f.id)})</span>` +
        (f.description ? ` — ${escapeHtml(f.description)}` : "") +
        `</li>`,
    )
    .join("");
  return makeCard("Features", `<ul class="features">${items}</ul>`);
}

/** @param {string} title  @param {string[]} items */
function listCard(title, items) {
  const html = `<ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
  return makeCard(title, html);
}

/** @param {string[]} written  @param {string | undefined} jarPath */
function filesCard(written, jarPath) {
  const groups = { Java: [], Resources: [], Textures: [] };
  for (const p of written) {
    const lower = p.toLowerCase();
    if (lower.endsWith(".java")) groups.Java.push(p);
    else if (lower.endsWith(".png") || lower.endsWith(".jpg")) groups.Textures.push(p);
    else groups.Resources.push(p);
  }
  /** @type {string[]} */
  const sections = [];
  for (const [label, files] of /** @type {[string, string[]][]} */ (Object.entries(groups))) {
    if (files.length === 0) continue;
    sections.push(
      `<h4>${escapeHtml(label)} <span class="muted">(${files.length})</span></h4>` +
      `<ul class="filelist">${files.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join("")}</ul>`,
    );
  }
  if (jarPath) {
    sections.push(
      `<h4>Build artifact <span class="muted">(1)</span></h4>` +
      `<ul class="filelist"><li><code>${escapeHtml(jarPath)}</code></li></ul>`,
    );
  }
  return makeCard("Generated files", sections.join(""));
}

/** @param {string} jobId  @param {string[]} pngs */
function texturesCard(jobId, pngs) {
  const tiles = pngs
    .map((p, i) => {
      const url = `/api/preview/${encodeURIComponent(jobId)}/${i}`;
      const label = p.split("/").slice(-2).join("/");
      return (
        `<figure class="tex">` +
        `<img src="${escapeAttr(url)}" alt="${escapeAttr(p)}" loading="lazy">` +
        `<figcaption><code>${escapeHtml(label)}</code></figcaption>` +
        `</figure>`
      );
    })
    .join("");
  return makeCard(
    "Texture previews",
    `<div class="tex-grid">${tiles}</div>` +
      `<p class="muted note-small">Previewed only by job id and the file index assigned by the codegen step. Arbitrary file paths cannot be requested.</p>`,
  );
}

/** @param {any[]} history */
function historyCard(history) {
  const items = history
    .map((h) => {
      const parts = [
        `<code>build #${h.attempt}</code> ${escapeHtml(h.buildReason)} (${(h.buildDurationMs / 1000).toFixed(1)}s)`,
      ];
      if (h.diagnosis) parts.push(`<div class="diag">diagnosis: ${escapeHtml(h.diagnosis)}</div>`);
      if (h.filesChanged && h.filesChanged.length) {
        parts.push(`<div class="changed">files changed: ${h.filesChanged.map(escapeHtml).join(", ")}</div>`);
      }
      if (h.stopReason) parts.push(`<div class="stop">stop: ${escapeHtml(h.stopReason)}</div>`);
      return `<li>${parts.join("")}</li>`;
    })
    .join("");
  return makeCard("Repair history", `<ol class="history">${items}</ol>`);
}

/** @param {string} title  @param {string} html */
function makeCard(title, html) {
  const sec = document.createElement("section");
  sec.className = "card result-card";
  sec.innerHTML = `<h3>${escapeHtml(title)}</h3>${html}`;
  return sec;
}

function wireCopyButtons() {
  for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("button.copy"))) {
    btn.addEventListener("click", async () => {
      const txt = btn.dataset.text ?? "";
      try {
        await navigator.clipboard.writeText(txt);
        const orig = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch (err) {
        btn.textContent = "Copy failed";
      }
    });
  }
  for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("button.action[data-finder]"))) {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.finder; // "open" | "reveal"
      const id = btn.dataset.job ?? "";
      if (!id) {
        btn.textContent = "Job id missing";
        setTimeout(() => { btn.textContent = "Re-run generation"; }, 2500);
        return;
      }
      if (!mode) return;
      const url = mode === "reveal" ? `/api/reveal/${encodeURIComponent(id)}` : `/api/open/${encodeURIComponent(id)}`;
      const orig = btn.textContent;
      btn.disabled = true;
      let restartHint = false;
      try {
        const r = await fetch(url, { method: "POST" });
        if (r.ok) {
          btn.textContent = mode === "reveal" ? "Revealed ✓" : "Opened ✓";
        } else {
          let detail = "";
          try { detail = (await r.json()).error ?? ""; } catch { /* */ }
          // If the server is stale (catch-all returns "not found" body),
          // the user just needs to restart. Tell them clearly.
          if (r.status === 404 && /^not found$/i.test(detail)) {
            restartHint = true;
            btn.textContent = "Server stale — restart npm run web";
          } else {
            btn.textContent = `Failed (${r.status})${detail ? ": " + detail : ""}`;
          }
        }
      } catch (e) {
        btn.textContent = "Network error";
      }
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
      }, restartHint ? 6000 : 2500);
    });
  }
}

/** @param {string} label  @param {string} value */
function renderCopyRow(label, value) {
  return (
    `<div class="row">` +
    `<span class="label">${escapeHtml(label)}</span>` +
    `<code>${escapeHtml(value)}</code>` +
    `<button class="copy" type="button" data-text="${escapeAttr(value)}">Copy</button>` +
    `</div>`
  );
}

/** @param {unknown} s */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    /** @type {Record<string,string>} */ ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c],
  );
}
/** @param {unknown} s */
function escapeAttr(s) { return escapeHtml(s); }

init();

// @ts-check
// ModForge — local web UI · vanilla JS · chat-style redesign (Milestone 3.6)
// Wires the redesigned UI to the existing API:
//   GET  /api/health
//   POST /api/generate          { idea }
//   GET  /api/events/:jobId     (SSE stream of GenerationEvent)
//   GET  /api/preview/:jobId/:i (PNG)
//   GET  /api/download/:jobId   (jar)
//   POST /api/open/:jobId       (open project folder)
//   POST /api/reveal/:jobId     (reveal jar)

// ---------- constants ----------

const REQUIRED_CAPABILITIES = ["generate", "events", "open", "reveal", "download"];

/**
 * Capabilities advertised by the running server. Populated by the /api/health
 * probe at init() time. Defensive default = an empty Set so anything that
 * inspects this before the probe finishes (e.g. an immediate Forge-mod click)
 * cleanly returns false instead of throwing ReferenceError.
 */
/** @type {Set<string>} */
let serverCapabilities = new Set();

/** True iff the server advertises the optional /api/clarify endpoint. */
function HAS_CLARIFY() {
  try {
    return serverCapabilities instanceof Set && serverCapabilities.has("clarify");
  } catch {
    return false;
  }
}

const STEP_DEFS = [
  { key: "setup",    label: "Checking your Minecraft setup" },
  { key: "spec",     label: "Understanding your mod idea" },
  { key: "scaffold", label: "Creating a clean mod project" },
  { key: "code",     label: "Writing code and textures" },
  { key: "build",    label: "Building the mod" },
  { key: "polish",   label: "Polishing the mod" },
];

const EXAMPLES = [
  "Add a void crystal item that is dark purple and glowing.",
  "Add a bloodstone block that is dark red and metallic.",
  "Retexture diamonds to look like black crystals.",
  "Make grass blocks dark purple.",
  "Add a copper hammer tool with high knockback.",
  "Add a simple command that gives the player a sapphire gem.",
];

const MAX_LOG_CHARS = 200_000;
const TRUNCATION_NOTE = "[earlier build log truncated by browser]\n";

// ---------- icons (SVG strings; safe to inject) ----------

const ICONS = {
  arrowUp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
  checkBig: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
  alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
  terminal: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
  cube: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 22V12"/></svg>',
  bolt: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
};

// ---------- state ----------

/**
 * @typedef {"empty" | "loading" | "success" | "error"} Mode
 *
 * @typedef {{
 *   mode: Mode,
 *   prompt: string,
 *   submittedPrompt: string,
 *   jobId: string | null,
 *   stepIdx: number,
 *   stepTimes: number[],
 *   currentStepStarted: number,
 *   logsOpen: boolean,
 *   advOpen: boolean,
 *   buildLog: string,
 *   spec: any | null,
 *   written: string[],
 *   uncoveredReasons: string[],
 *   outcome: any | null,
 *   projectPath: string | null,
 *   error: string | null,
 *   lastCompletedStep: string,
 *   serverWarning: string | null,
 *   history: Array<{ id: string, prompt: string }>,
 * }} State
 */

/** @type {any} */
const state = {
  mode: "empty", // "empty" | "clarifying" | "loading" | "success" | "error"
  prompt: "",
  submittedPrompt: "",
  jobId: null,
  stepIdx: 0,
  stepTimes: STEP_DEFS.map(() => 0),
  currentStepStarted: 0,
  logsOpen: false,
  advOpen: false,
  buildLog: "",
  spec: null,
  written: [],
  uncoveredReasons: [],
  outcome: null,
  projectPath: null,
  error: null,
  lastCompletedStep: "",
  serverWarning: null,
  history: [],
  // ---- Milestone 3.8 — clarification flow ----
  clarification: null,
  // {
  //   questions: ClarificationQuestion[],
  //   answers: Record<string,string>,
  //   otherInputs: Record<string,string>,
  //   summaryTemplate: string,
  //   loading: boolean,
  //   error: string | null,
  // }
  summaryMessage: null, // string shown above progress after Continue
};

/** @type {EventSource | null} */
let currentSource = null;

// ---------- entry ----------

/**
 * Promise that resolves when the /api/health probe finishes (success OR
 * failure). submit() awaits this so we never decide clarify-vs-generate
 * with a stale empty capability set.
 *
 * On success: populates the module-level `serverCapabilities` Set.
 * On failure: leaves capabilities empty + sets state.serverWarning.
 */
/** @type {Promise<void> | null} */
let capabilitiesReady = null;

function loadCapabilities() {
  if (capabilitiesReady) return capabilitiesReady;
  capabilitiesReady = fetch("/api/health")
    .then((r) => r.json())
    .then((j) => {
      // CRITICAL: assign to the MODULE-LEVEL variable so HAS_CLARIFY() actually sees it.
      serverCapabilities = new Set(Array.isArray(j.capabilities) ? j.capabilities : []);
      const missing = REQUIRED_CAPABILITIES.filter((c) => !serverCapabilities.has(c));
      if (missing.length > 0) {
        state.serverWarning =
          `Server is out of date — missing endpoints: ${missing.join(", ")}. ` +
          `Restart with \`npm run web\` to pick up the latest code.`;
        render();
      }
    })
    .catch(() => {
      // Reset so a future submit retries the probe.
      capabilitiesReady = null;
      state.serverWarning = "API unreachable — is the local server running?";
      render();
      // Re-throw so callers (submit) can show an explicit error.
      throw new Error("Capability probe failed");
    });
  return capabilitiesReady;
}

const HISTORY_STORAGE_KEY = "modforge.history.v1";

function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((h) => h && typeof h.id === "string" && typeof h.prompt === "string")
      .slice(0, 12);
  } catch { return []; }
}

function saveHistoryToStorage() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history));
  } catch { /* quota / private mode — ignore */ }
}

function init() {
  state.history = loadHistoryFromStorage();
  // Initial render.
  render();
  // Kick off the capability probe; ignore the rejection here — submit() will
  // re-trigger it and surface the error to the user.
  loadCapabilities().catch(() => { /* surfaced later via state.serverWarning */ });
}

// ---------- render orchestration ----------

function render() {
  const root = document.getElementById("root");
  if (!root) return;
  // Build the new tree off-DOM, then swap in.
  const next = buildApp();
  root.replaceChildren(next);
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// ---------- DOM helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "className") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset" && typeof v === "object") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
    } else if (typeof v === "boolean") {
      if (v) node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function svg(html) {
  const span = document.createElement("span");
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.innerHTML = html;
  return span;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 100) / 10);
  return s.toFixed(1) + "s";
}

function basename(p) {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

function prettyName(s) {
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ---------- build the full UI ----------

function buildApp() {
  return el("div", { className: "app" },
    buildSidebar(),
    buildMain(),
  );
}

function buildSidebar() {
  return el("aside", { className: "sidebar" },
    el("div", { className: "brand" },
      el("div", { className: "brand-mark", "aria-hidden": "true" },
        ...Array.from({ length: 9 }, () => el("span"))),
      el("div", { className: "brand-name" }, "ModForge"),
    ),
    el("button", { className: "side-new", onClick: resetToEmpty },
      el("span", { className: "plus", html: ICONS.plus }),
      "New mod",
    ),
    el("div", null,
      el("div", { className: "side-section-label" }, "Recent"),
      buildSideHistory(),
    ),
    el("div", { className: "side-foot" },
      el("div", { className: "pill" },
        el("span", { className: "live" }),
        "Local · Fabric 1.20.1",
      ),
      el("div", { style: { paddingLeft: "4px" } }, "127.0.0.1 · Java 17 / Gradle 8"),
      state.serverWarning &&
        el("div", { className: "warn-pill", html: stalifyWarning(state.serverWarning) }),
    ),
  );
}

function stalifyWarning(s) {
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function buildSideHistory() {
  if (state.history.length === 0) {
    return el("div", { className: "side-empty" }, "No mods yet.");
  }
  return el("div", { className: "side-list" },
    state.history.map((h) =>
      el("button", {
        className: "side-item" + (h.id === state.jobId ? " is-active" : ""),
        title: h.prompt,
        onClick: () => loadJob(h.id, h.prompt),
      },
        el("span", { className: "dot" }),
        el("span", { className: "side-item-text" }, h.prompt),
      ),
    ),
  );
}

function buildMain() {
  return el("div", { className: "main" },
    buildTopbar(),
    el("div", { className: "scroller" },
      el("div", { className: "canvas" }, ...buildCanvas()),
    ),
  );
}

function buildTopbar() {
  const title = state.mode === "empty"
    ? "New mod"
    : (state.spec?.modName ?? state.submittedPrompt.slice(0, 56) + (state.submittedPrompt.length > 56 ? "…" : ""));
  const status = state.mode === "loading" ? "forging…"
    : state.mode === "success" ? "ready"
    : state.mode === "error" ? "needs attention"
    : "";
  return el("div", { className: "topbar" },
    el("span", { className: "crumb muted" }, "Workspace"),
    el("span", { className: "sep" }, "/"),
    el("span", { className: "crumb" }, title || "New mod"),
    status && el("span", { className: "sep" }, "·"),
    status && el("span", { style: { color: "var(--fg-3)" } }, status),
    el("div", { className: "right" },
      el("button", { className: "ghost-btn", onClick: resetToEmpty },
        svg(ICONS.refresh),
        el("span", { style: { marginLeft: "6px" } }, "Reset"),
      ),
    ),
  );
}

function buildCanvas() {
  if (state.mode === "empty") {
    return [
      buildHero(),
      buildComposer(false),
      buildChips(),
      buildFootHint(),
    ];
  }
  const result = [];
  result.push(buildThread());
  if (state.mode === "clarifying") {
    result.push(buildClarificationCard());
  }
  if (state.mode === "success") {
    result.push(buildResult());
    result.push(buildCardsRow());
    result.push(buildAdvanced());
  }
  if (state.mode === "error") {
    result.push(buildErrorCard());
  }
  return result;
}

// ---------- empty state ----------

function buildHero() {
  return el("div", { className: "hero" },
    el("h1", null, "Build a Minecraft mod."),
    el("p", { className: "tagline" }, "Describe a Minecraft mod. Get a working jar."),
  );
}

function buildComposer(disabled) {
  const ta = el("textarea", {
    rows: "3",
    placeholder: "Describe a Minecraft mod… e.g. retexture diamonds to look like black crystals, or add a glowing void crystal item.",
    onInput: (e) => { state.prompt = e.target.value; autoresize(e.target); updateSendDisabled(); },
    onKeyDown: (e) => {
      // Enter submits; Shift+Enter inserts a newline. Cmd/Ctrl+Enter also
      // submits for parity with the previous shortcut. Route through
      // safeSubmit so a thrown error renders the error card, matching the
      // click-handler behavior on the Forge button.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        safeSubmit();
      }
    },
    disabled,
  });
  ta.value = state.prompt;
  // schedule autoresize after mount
  setTimeout(() => autoresize(ta), 0);

  const sendBtn = el("button", {
    className: "send-btn",
    onClick: safeSubmit,
    disabled: disabled || state.prompt.trim().length === 0,
  },
    "Forge mod",
    el("span", { className: "arrow", html: ICONS.arrowUp }),
  );

  return el("div", { className: "composer" },
    ta,
    el("div", { className: "composer-bar" },
      el("div", { className: "left" },
        el("span", { className: "iconbtn" },
          svg(ICONS.cube),
          el("span", { style: { marginLeft: "6px" } }, "Fabric 1.20.1"),
        ),
      ),
      el("div", { className: "right" },
        el("span", { className: "iconbtn", style: { pointerEvents: "none" } },
          el("span", { className: "kbd" }, "⌘"),
          el("span", { className: "kbd", style: { marginLeft: "4px" } }, "↵"),
        ),
        sendBtn,
      ),
    ),
  );
}

function autoresize(ta) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 280) + "px";
}

function updateSendDisabled() {
  const btn = document.querySelector(".send-btn");
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = state.prompt.trim().length === 0;
  }
}

function buildChips() {
  return el("div", { className: "chips-row" },
    EXAMPLES.map((s) =>
      el("button", {
        className: "chip",
        onClick: () => {
          state.prompt = s;
          render();
        },
      },
        el("span", { className: "chip-dot" }),
        s,
      ),
    ),
  );
}

function buildFootHint() {
  return el("div", { className: "foot-hint" },
    el("span", null, svg(ICONS.bolt), el("span", { style: { marginLeft: "6px" } }, "Runs entirely on your machine")),
    el("span", { className: "dotsep" }, "·"),
    el("span", null, svg(ICONS.cube), el("span", { style: { marginLeft: "6px" } }, "Outputs a Fabric .jar")),
    el("span", { className: "dotsep" }, "·"),
    el("span", null, svg(ICONS.terminal), el("span", { style: { marginLeft: "6px" } }, "Java 17 + Gradle 8 required")),
  );
}

// ---------- chat thread ----------

function buildThread() {
  const items = [];
  items.push(
    el("div", { className: "msg-user" }, state.submittedPrompt || state.prompt),
  );

  if (state.mode === "clarifying") {
    items.push(buildClarifyingIntro());
    return el("div", { className: "thread" }, ...items);
  }

  // loading / success / error
  if (state.summaryMessage) {
    items.push(buildSimpleAssistantBubble(state.summaryMessage));
  }
  items.push(buildAssistantBubble());
  return el("div", { className: "thread" }, ...items);
}

function buildClarifyingIntro() {
  const c = state.clarification;
  const body = el("div", { className: "bubble" });
  if (c?.loading) {
    body.appendChild(el("div", { className: "bubble-title" },
      "Thinking about your idea",
      el("span", { className: "caret" }),
    ));
  } else if (c?.error) {
    body.appendChild(el("div", { className: "bubble-title" }, "Couldn't load clarification questions."));
    body.appendChild(el("div", { className: "muted", style: { fontSize: "13px" } }, c.error));
  } else {
    body.appendChild(el("div", { className: "bubble-title" },
      "A couple quick questions before I build this:"));
  }
  return el("div", { className: "msg-assistant" },
    el("div", { className: "avatar", "aria-hidden": "true" },
      ...Array.from({ length: 9 }, () => el("span"))),
    body,
  );
}

/** Simple assistant bubble used for the post-clarification "Got it." message. */
function buildSimpleAssistantBubble(text) {
  return el("div", { className: "msg-assistant" },
    el("div", { className: "avatar", "aria-hidden": "true" },
      ...Array.from({ length: 9 }, () => el("span"))),
    el("div", { className: "bubble" },
      el("div", { className: "bubble-title" }, text),
    ),
  );
}

function buildAssistantBubble() {
  const body = el("div", { className: "bubble" });
  if (state.mode === "loading") {
    body.appendChild(el("div", { className: "bubble-title" },
      "On it. Building your mod now",
      el("span", { className: "caret" }),
    ));
  } else if (state.mode === "success") {
    body.appendChild(el("div", { className: "bubble-title" }, "All finished — your mod is ready."));
  } else if (state.mode === "error") {
    body.appendChild(el("div", { className: "bubble-title" }, "I hit a snag."));
  }
  body.appendChild(buildProgressList());
  body.appendChild(buildLogsDisclosure());
  return el("div", { className: "msg-assistant" },
    el("div", { className: "avatar", "aria-hidden": "true" },
      ...Array.from({ length: 9 }, () => el("span"))),
    body,
  );
}

// ---------- clarification card ----------

function buildClarificationCard() {
  const c = state.clarification;
  if (!c || c.loading) return el("div");

  const questionEls = c.questions.map((q) => buildQuestion(q));
  const allRequiredAnswered = c.questions.every((q) => questionAnswered(q));

  const continueBtn = el("button", {
    className: "btn-primary clarify-continue",
    disabled: !allRequiredAnswered,
    onClick: continueAfterClarification,
  }, "Continue");

  return el("div", { className: "clarify-card" },
    ...questionEls,
    el("div", { className: "clarify-actions" },
      continueBtn,
      el("button", {
        className: "btn-secondary",
        onClick: resetToEmpty,
      }, "Cancel"),
    ),
  );
}

function questionAnswered(q) {
  const c = state.clarification;
  if (!c) return false;
  const a = c.answers[q.id];
  if (a === undefined || a === null || String(a).trim().length === 0) return false;
  if (q.type === "choice" && String(a).toLowerCase() === "other") {
    const other = (c.otherInputs[q.id] ?? "").trim();
    return other.length > 0;
  }
  return true;
}

function buildQuestion(q) {
  const c = state.clarification;
  const wrapper = el("div", { className: "clarify-q" },
    el("div", { className: "clarify-q-text" }, q.question),
  );
  if (q.type === "choice") {
    const pills = el("div", { className: "clarify-pills" });
    for (const choice of q.choices) {
      const selected = c.answers[q.id] === choice;
      pills.appendChild(el("button", {
        className: "clarify-pill" + (selected ? " is-selected" : ""),
        type: "button",
        onClick: () => {
          c.answers[q.id] = choice;
          render();
        },
      }, choice));
    }
    wrapper.appendChild(pills);
    if (c.answers[q.id] && String(c.answers[q.id]).toLowerCase() === "other") {
      const otherInput = el("input", {
        type: "text",
        className: "clarify-other",
        placeholder: "Type your own answer…",
        value: c.otherInputs[q.id] ?? "",
        onInput: (e) => {
          c.otherInputs[q.id] = e.target.value;
          // Lightweight update — only re-render the Continue button's disabled state.
          updateContinueDisabled();
        },
      });
      wrapper.appendChild(otherInput);
    }
  } else {
    // free_text
    const ta = el("textarea", {
      rows: "2",
      className: "clarify-freetext",
      placeholder: q.placeholder ?? "Type your answer…",
      value: c.answers[q.id] ?? "",
      onInput: (e) => {
        c.answers[q.id] = e.target.value;
        updateContinueDisabled();
      },
    });
    ta.value = c.answers[q.id] ?? "";
    wrapper.appendChild(ta);
  }
  return wrapper;
}

function updateContinueDisabled() {
  const btn = document.querySelector(".clarify-continue");
  if (!(btn instanceof HTMLButtonElement)) return;
  const c = state.clarification;
  if (!c) return;
  btn.disabled = !c.questions.every((q) => questionAnswered(q));
}

function buildProgressList() {
  const finished = state.mode === "success";
  const currentIdx = finished ? STEP_DEFS.length : state.stepIdx;
  const rows = STEP_DEFS.map((step, i) => {
    const status = finished || i < currentIdx ? "done" : i === currentIdx ? "active" : "idle";
    const cls = "step" + (status === "active" ? " is-active" : status === "done" ? " is-done" : "");
    const children = [
      el("span", { className: "step-icon" },
        status === "done" ? svg(ICONS.check) : null,
      ),
      el("span", null, step.label + (status === "active" ? "…" : "")),
    ];
    if (status === "done" && state.stepTimes[i] > 0) {
      children.push(el("span", { className: "step-time" }, fmtTime(state.stepTimes[i])));
    }
    return el("div", { className: cls }, ...children);
  });

  if (finished) {
    const total = state.stepTimes.reduce((a, b) => a + (b || 0), 0);
    rows.push(
      el("div", { className: "step is-done", style: { marginTop: "4px" } },
        el("span", { className: "step-icon" }, svg(ICONS.check)),
        el("span", { style: { color: "var(--fg)", fontWeight: "500" } }, "All finished!"),
        total > 0 ? el("span", { className: "step-time" }, "total " + fmtTime(total)) : null,
      ),
    );
  }
  return el("div", { className: "steps" }, ...rows);
}

function buildLogsDisclosure() {
  const lines = state.buildLog
    ? state.buildLog
    : "(no Gradle output yet)\n";
  return el("div", { className: "logs" + (state.logsOpen ? " is-open" : "") },
    el("div", {
      className: "logs-head",
      onClick: () => setState({ logsOpen: !state.logsOpen }),
    },
      el("span", { className: "chev", html: ICONS.chevron }),
      el("span", { className: "label" }, "Show technical log"),
      el("span", { className: "meta" },
        state.buildLog
          ? `${Math.round(state.buildLog.length / 1024)} KB`
          : "0 KB"),
    ),
    el("div", { className: "logs-body" },
      el("pre", null, lines),
    ),
  );
}

// ---------- success result ----------

function buildResult() {
  const o = state.outcome ?? {};
  const jarPath = o.success ? o.jarPath : undefined;
  const jarFilename = jarPath ? basename(jarPath) : "(no jar)";
  const subtitle = state.spec
    ? `${state.spec.modName ?? state.spec.modId} · Fabric ${state.spec.mcVersion ?? "1.20.1"}`
    : "Fabric 1.20.1";

  const grid = el("div", { className: "result-grid" });
  grid.appendChild(buildJarCard(jarFilename, jarPath));
  const tex = buildTextureCard();
  if (tex) grid.appendChild(tex);

  return el("div", { className: "result" },
    el("div", { className: "result-head" },
      el("div", { className: "check", html: ICONS.checkBig }),
      el("div", null,
        el("div", { className: "result-title" }, "All finished — your mod is ready."),
        el("div", { className: "result-sub" }, subtitle),
      ),
    ),
    grid,
  );
}

function buildJarCard(jarFilename, jarPath) {
  const id = state.jobId ?? "";
  const dlHref = id && jarPath ? `/api/download/${encodeURIComponent(id)}` : "";

  const downloadBtn = jarPath
    ? el("a", {
        className: "btn-primary",
        href: dlHref,
        download: jarFilename,
      },
        svg(ICONS.download),
        "Download jar",
      )
    : el("button", { className: "btn-primary", disabled: true },
        svg(ICONS.download),
        "No jar produced",
      );

  const revealBtn = el("button", {
    className: "btn-secondary",
    disabled: !id || !jarPath,
    onClick: (e) => callHelper(e.currentTarget, "reveal"),
  },
    svg(ICONS.eye),
    el("span", { style: { marginLeft: "8px" } }, "Reveal jar"),
  );
  const openBtn = el("button", {
    className: "btn-secondary",
    disabled: !id,
    onClick: (e) => callHelper(e.currentTarget, "open"),
  },
    svg(ICONS.folder),
    el("span", { style: { marginLeft: "8px" } }, "Open project folder"),
  );

  return el("div", { className: "jar-card" },
    el("div", { className: "jar-meta" },
      el("div", { className: "jar-icon" }, "JAR"),
      el("div", { style: { minWidth: "0", flex: "1" } },
        el("div", { className: "jar-name" }, jarFilename),
        el("div", { className: "jar-stats" },
          jarPath
            ? el("span", null, el("b", null, "ready"))
            : el("span", null, "—"),
          el("span", null, `MC ${state.spec?.mcVersion ?? "1.20.1"}`),
          el("span", null, "Fabric"),
        ),
      ),
    ),
    downloadBtn,
    el("div", { className: "btn-row" }, revealBtn, openBtn),
  );
}

function buildTextureCard() {
  const pngs = state.written.filter((p) => p.toLowerCase().endsWith(".png"));
  if (pngs.length === 0 || !state.jobId) return null;
  const tiles = pngs.slice(0, 9).map((path, i) => {
    const url = `/api/preview/${encodeURIComponent(state.jobId)}/${i}`;
    const label = path.split("/").slice(-1)[0];
    return el("div", { className: "tex-tile" },
      el("div", { className: "tex" },
        el("img", { src: url, alt: path, loading: "lazy" }),
      ),
      el("div", { className: "tex-label" }, label),
    );
  });
  return el("div", { className: "texture-card" },
    el("div", { className: "texture-card-head" },
      el("b", null, "Generated textures"),
      el("span", null, `16×16 px · ${pngs.length} file${pngs.length === 1 ? "" : "s"}`),
    ),
    el("div", { className: "texture-grid" }, ...tiles),
  );
}

function buildCardsRow() {
  return el("div", { className: "cards-row" },
    buildInstallCard(),
    buildTestCard(),
  );
}

function buildInstallCard() {
  const jarFilename = state.outcome?.jarPath ? basename(state.outcome.jarPath) : "your-mod.jar";
  const ol = el("ol", { className: "steps-list" },
    el("li", null,
      el("span", { className: "step-n" }, "1"),
      el("span", null, "Install ", el("a", {
        href: "https://fabricmc.net/use/installer/",
        target: "_blank",
        rel: "noopener noreferrer",
      }, "Fabric Loader"), " for Minecraft ", el("code", null, "1.20.1"), "."),
    ),
    el("li", null,
      el("span", { className: "step-n" }, "2"),
      el("span", null, "Download ", el("a", {
        href: "https://modrinth.com/mod/fabric-api/versions?g=1.20.1",
        target: "_blank",
        rel: "noopener noreferrer",
      }, "Fabric API"), " for 1.20.1."),
    ),
    el("li", null,
      el("span", { className: "step-n" }, "3"),
      el("span", null, "Drop both jars into your Minecraft mods folder:"),
    ),
    el("li", null,
      el("span", { className: "step-n" }, " "),
      el("span", null,
        el("code", null, "~/Library/Application Support/minecraft/mods"),
        el("span", { style: { color: "var(--fg-4)", marginLeft: "8px", fontSize: "11.5px" } }, "macOS"),
      ),
    ),
    el("li", null,
      el("span", { className: "step-n" }, "4"),
      el("span", null,
        "The downloaded jar is named ", el("code", null, jarFilename), ".",
      ),
    ),
    el("li", null,
      el("span", { className: "step-n" }, "5"),
      el("span", null, "Launch the ", el("strong", null, "Fabric 1.20.1"), " profile."),
    ),
  );
  return el("div", { className: "info-card" },
    el("div", { className: "info-head" },
      el("div", { className: "info-num" }, "1"),
      el("div", null,
        el("div", { className: "info-title" }, "Install"),
        el("p", { className: "info-sub" }, "Drop the jar into your mods folder."),
      ),
    ),
    ol,
  );
}

function buildTestCard() {
  const features = state.spec?.features ?? [];
  const giveLines = [];
  const cmdLines = [];
  const retexNotes = [];
  for (const f of features) {
    if (["item", "block", "tool", "weapon"].includes(f.type)) {
      giveLines.push(`/give @p ${state.spec.modId}:${f.id}`);
    } else if (f.type === "command") {
      cmdLines.push(`/${f.details.commandName}`);
    } else if (f.type === "retexture_item") {
      const target = f.details.vanillaTarget;
      const path = target.replace(/^minecraft:/, "");
      retexNotes.push({ kind: "item", target, label: prettyName(path), path });
    } else if (f.type === "retexture_block") {
      const target = f.details.vanillaTarget;
      const path = target.replace(/^minecraft:/, "");
      retexNotes.push({ kind: "block", target, label: prettyName(path), path });
    }
  }

  const body = [];
  if (giveLines.length > 0) {
    body.push(el("p", { style: { margin: "0 0 6px", fontSize: "13px", color: "var(--fg-2)" } },
      "Open chat (cheats enabled) and run:"));
    body.push(el("pre", { className: "cmd-block" }, giveLines.join("\n")));
  }
  if (cmdLines.length > 0) {
    body.push(el("p", { style: { margin: "8px 0 6px", fontSize: "13px", color: "var(--fg-2)" } },
      "Custom commands (operator level):"));
    body.push(el("pre", { className: "cmd-block" }, cmdLines.join("\n")));
  }
  if (retexNotes.length > 0) {
    body.push(el("p", { style: { margin: "8px 0 6px", fontSize: "13px", color: "var(--fg-2)" } },
      "Open Creative inventory and look at these vanilla items/blocks — their textures should be replaced:"));
    const ul = el("ul", null);
    for (const n of retexNotes) {
      const grass = n.target === "minecraft:grass_block";
      const note = n.kind === "item"
        ? ` (the item, not its ore — search "${n.path}")`
        : grass ? " (top + side faces; bottom is dirt and is intentionally not retextured)" : "";
      ul.appendChild(
        el("li", { style: { fontSize: "13px", lineHeight: "1.55", color: "var(--fg-2)" } },
          el("strong", null, n.label),
          " — ",
          el("code", null, n.target),
          el("span", { style: { color: "var(--fg-3)" } }, note),
        ),
      );
    }
    body.push(ul);
  }
  if (body.length === 0) {
    body.push(el("p", { style: { color: "var(--fg-3)", fontSize: "13px", margin: "0" } },
      "This mod has no items, blocks, commands, or retextures to test interactively."));
  }

  return el("div", { className: "info-card" },
    el("div", { className: "info-head" },
      el("div", { className: "info-num" }, "2"),
      el("div", null,
        el("div", { className: "info-title" }, "How to test it"),
        el("p", { className: "info-sub" }, "A 30-second sanity check in-game."),
      ),
    ),
    ...body,
  );
}

// ---------- advanced details ----------

function buildAdvanced() {
  const o = state.outcome ?? {};
  const grid = el("div", { className: "adv-grid" },
    advCell("Mod ID", state.spec?.modId ?? "—"),
    advCell("Version", state.spec?.modVersion ?? "—"),
    advCell("Loader", "Fabric"),
    advCell("Minecraft", state.spec?.mcVersion ?? "1.20.1"),
    advCell("Build", o.success ? `success (${o.buildAttempts ?? 1} attempt${o.buildAttempts === 1 ? "" : "s"})` : `failed: ${o.finalReason ?? "?"}`),
    advCell("Repairs", String(o.repairAttempts ?? 0)),
    advCell("Project path", state.projectPath ?? "—"),
    advCell("JAR", o.jarPath ? basename(o.jarPath) : "—"),
  );
  const filesList = el("div", { className: "adv-files" });
  for (const path of state.written) {
    const lower = path.toLowerCase();
    const lang = lower.endsWith(".java") ? "Java"
      : lower.endsWith(".png") ? "PNG"
      : lower.endsWith(".json") ? "JSON"
      : "FILE";
    filesList.appendChild(el("div", { className: "adv-file-row" },
      el("span", { className: "lang" }, lang),
      el("span", { className: "name" }, path),
    ));
  }

  const sections = [grid];
  if (state.written.length > 0) sections.push(filesList);
  if (state.uncoveredReasons.length > 0) {
    sections.push(el("div", { style: { marginTop: "12px", fontSize: "12.5px", color: "var(--fg-3)" } },
      el("div", { style: { color: "var(--fg-2)", marginBottom: "4px", fontWeight: "500" } },
        "Uncovered features (forced AI fallback)"),
      el("ul", { style: { margin: "0 0 0 16px", padding: "0" } },
        ...state.uncoveredReasons.map((r) => el("li", null, r))),
    ));
  }
  if (Array.isArray(o.history) && o.history.length > 0) {
    const hist = el("div", { className: "adv-history" });
    for (const h of o.history) {
      hist.appendChild(el("div", { className: "adv-history-row" },
        el("div", { className: "ah-head" },
          `build #${h.attempt}`,
          el("span", { style: { color: "var(--fg-4)" } }, " · "),
          h.buildReason,
          el("span", { style: { color: "var(--fg-4)" } }, ` · ${(h.buildDurationMs / 1000).toFixed(1)}s`),
        ),
        h.diagnosis ? el("div", { className: "ah-detail" }, "diagnosis: ", h.diagnosis) : null,
        h.filesChanged && h.filesChanged.length
          ? el("div", { className: "ah-detail" }, "files changed: ", h.filesChanged.join(", "))
          : null,
        h.stopReason ? el("div", { className: "ah-detail" }, "stop: ", h.stopReason) : null,
      ));
    }
    sections.push(hist);
  }

  return el("div", { className: "advanced" + (state.advOpen ? " is-open" : "") },
    el("div", {
      className: "advanced-head",
      onClick: () => setState({ advOpen: !state.advOpen }),
    },
      el("span", { className: "chev", html: ICONS.chevron }),
      el("span", { className: "label" }, "Advanced details"),
      el("span", { className: "meta" },
        `${state.written.length} files${o.history?.length ? ` · ${o.history.length} attempts` : ""}`),
    ),
    el("div", { className: "advanced-body" }, ...sections),
  );
}

function advCell(k, v) {
  return el("div", { className: "adv-cell" },
    el("div", { className: "k" }, k),
    el("div", { className: "v" }, String(v ?? "—")),
  );
}

// ---------- error state ----------

function buildErrorCard() {
  const msg = state.error ?? "Generation failed.";
  let suggestion = "Try a simpler prompt, or pick one of the example prompts.";
  const lower = msg.toLowerCase();
  if (lower.includes("preflight")) suggestion = "Install JDK 17+ and Gradle 8.x (not 9.x), then re-run.";
  else if (lower.includes("anthropic_api_key")) suggestion = "Set ANTHROPIC_API_KEY in your .env and restart npm run web.";
  else if (lower.includes("timeout")) suggestion = "Try again — the second run is faster because Gradle's cache is warm.";
  else if (lower.includes("max-repairs") || lower.includes("no-progress") || lower.includes("no-changes")) {
    suggestion = "The repair loop couldn't fix the build. Try a simpler prompt.";
  }
  return el("div", { className: "error-card" },
    el("div", { className: "error-icon", html: ICONS.alert }),
    el("div", { style: { flex: "1", minWidth: "0" } },
      el("h3", null, "Build didn't quite work."),
      el("p", null,
        "Last completed step: ",
        el("code", null, state.lastCompletedStep || "(none)"),
        ". ",
        msg,
        " ",
        suggestion,
      ),
      el("div", { className: "error-actions" },
        el("button", { className: "btn-retry", onClick: resetToEmpty },
          svg(ICONS.refresh),
          el("span", { style: { marginLeft: "6px" } }, "Try again"),
        ),
        el("button", {
          className: "btn-secondary",
          style: { height: "34px", padding: "0 12px" },
          onClick: () => setState({ logsOpen: true }),
        },
          svg(ICONS.terminal),
          el("span", { style: { marginLeft: "6px" } }, "Open log"),
        ),
      ),
    ),
  );
}

// ---------- generation flow ----------

/**
 * Wrap submit() so ANY error — including a synchronous throw before the
 * first state mutation — produces a visible error card instead of failing
 * silently. The Forge mod button must never look broken.
 */
async function safeSubmit() {
  try {
    await submit();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("submit failed", err);
    state.mode = "error";
    state.error = "Couldn't start: " + msg;
    state.lastCompletedStep = state.lastCompletedStep || "(nothing yet)";
    render();
  }
}

async function submit() {
  const prompt = state.prompt.trim();
  if (prompt.length === 0) return;

  // Reset run state up front (clears any prior result/error).
  Object.assign(state, {
    submittedPrompt: prompt,
    jobId: null,
    stepIdx: 0,
    stepTimes: STEP_DEFS.map(() => 0),
    currentStepStarted: Date.now(),
    logsOpen: false,
    advOpen: false,
    buildLog: "",
    spec: null,
    written: [],
    uncoveredReasons: [],
    outcome: null,
    projectPath: null,
    error: null,
    lastCompletedStep: "",
    clarification: null,
    summaryMessage: null,
  });

  // CRITICAL: always await the capability probe before deciding clarify vs
  // direct generate. Without this, a fast click can race the /api/health
  // fetch and HAS_CLARIFY() returns false from a still-empty Set.
  try {
    await loadCapabilities();
  } catch {
    state.mode = "error";
    state.error = "Cannot reach the local API. Is the server running? (npm run web)";
    render();
    return;
  }

  // eslint-disable-next-line no-console
  console.debug("[ModForge] clarify supported:", HAS_CLARIFY());

  if (HAS_CLARIFY()) {
    state.mode = "clarifying";
    state.clarification = {
      questions: [],
      answers: {},
      otherInputs: {},
      summaryTemplate: "",
      loading: true,
      error: null,
    };
    render();

    let cr;
    try {
      const res = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: prompt }),
      });
      if (!res.ok) {
        const detail = await safeError(res);
        // Server supports clarify but the call failed. Do NOT silently fall
        // through to /api/generate — show a visible error in the clarification
        // card so the user knows to retry instead of getting an unrelated mod.
        state.clarification.loading = false;
        state.clarification.error = `Clarification failed (${res.status}): ${detail}. Try again, or restart npm run web.`;
        render();
        return;
      }
      cr = await res.json();
    } catch (e) {
      state.clarification.loading = false;
      state.clarification.error =
        "Network error reaching /api/clarify: " +
        (e instanceof Error ? e.message : String(e));
      render();
      return;
    }

    // eslint-disable-next-line no-console
    console.debug("[ModForge] clarify response:", cr);

    if (cr.skip === true) {
      // Server explicitly says no clarification needed.
      await startGenerationDirectly(prompt);
      return;
    }
    if (!Array.isArray(cr.questions) || cr.questions.length === 0) {
      // Malformed (skip is falsy but no questions). Treat as schema error.
      state.clarification.loading = false;
      state.clarification.error =
        "Clarification response was malformed (no questions). Try again.";
      render();
      return;
    }

    // Render questions and wait for the user to press Continue.
    state.clarification.questions = cr.questions;
    state.clarification.summaryTemplate = cr.summary ?? "";
    state.clarification.loading = false;
    render();
    return;
  }

  // Server genuinely doesn't advertise clarify — direct generate is the
  // intentional fallback (older server build).
  await startGenerationDirectly(prompt);
}

async function continueAfterClarification() {
  if (!state.clarification) return;
  const { questions, answers, otherInputs, summaryTemplate } = state.clarification;
  // Resolve final answers (substituting Other-text where chosen).
  const resolved = {};
  for (const q of questions) {
    const a = answers[q.id];
    if (a === undefined) continue;
    if (q.type === "choice" && a.toLowerCase() === "other") {
      resolved[q.id] = (otherInputs[q.id] ?? "").trim();
    } else {
      resolved[q.id] = a.trim();
    }
  }
  // Build the clarified idea: original prompt + bullet-style answers (plain text;
  // never becomes a path, just feeds the planner).
  const clarifiedIdea = buildClarifiedIdea(state.submittedPrompt, questions, resolved);
  state.summaryMessage = renderSummaryTemplate(summaryTemplate, resolved) ||
    "Got it. Building this for you now.";
  await startGenerationDirectly(clarifiedIdea);
}

function buildClarifiedIdea(originalIdea, questions, answers) {
  const parts = [originalIdea.trim()];
  const lines = [];
  for (const q of questions) {
    const a = (answers[q.id] ?? "").trim();
    if (a.length === 0) continue;
    lines.push(`- ${q.id}: ${a}`);
  }
  if (lines.length > 0) {
    parts.push("\nClarifications:");
    parts.push(...lines);
  }
  return parts.join("\n");
}

function renderSummaryTemplate(template, answers) {
  if (!template) return "";
  return template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, id) => answers[id] ?? `{${id}}`);
}

async function safeError(res) {
  try { return (await res.json()).error ?? `${res.status}`; } catch { return String(res.status); }
}

async function startGenerationDirectly(idea) {
  state.mode = "loading";
  state.currentStepStarted = Date.now();
  render();

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    });
  } catch (e) {
    state.mode = "error";
    state.error = "Network error: " + (e instanceof Error ? e.message : String(e));
    render();
    return;
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error ?? ""; } catch { /* */ }
    state.mode = "error";
    state.error = `API error (${res.status})${detail ? ": " + detail : ""}`;
    render();
    return;
  }
  const { jobId } = await res.json();
  state.jobId = jobId;
  state.history = [{ id: jobId, prompt: state.submittedPrompt }, ...state.history.filter((h) => h.id !== jobId)].slice(0, 12);
  saveHistoryToStorage();
  render();

  if (currentSource) currentSource.close();
  const ev = new EventSource(`/api/events/${encodeURIComponent(jobId)}`);
  currentSource = ev;
  ev.addEventListener("message", (m) => {
    try { handleEvent(JSON.parse(m.data)); } catch (err) { console.error("bad event payload", err); }
  });
  ev.addEventListener("error", () => {
    if (ev.readyState === EventSource.CLOSED) finalizeStream();
  });
}

function finalizeStream() {
  if (currentSource) {
    try { currentSource.close(); } catch { /* */ }
    currentSource = null;
  }
}

/**
 * Re-open a previously-generated job and replay its event stream so the
 * canvas, previews, and download button all come back. The server keeps
 * each job's events buffered for an hour; if it's been GC'd, surface a
 * friendly error instead of leaving the user on an empty progress card.
 */
function loadJob(jobId, prompt) {
  if (!jobId || jobId === state.jobId) return;
  finalizeStream();
  Object.assign(state, {
    mode: "loading",
    prompt,
    submittedPrompt: prompt,
    jobId,
    stepIdx: 0,
    stepTimes: STEP_DEFS.map(() => 0),
    currentStepStarted: Date.now(),
    logsOpen: false,
    advOpen: false,
    buildLog: "",
    spec: null,
    written: [],
    uncoveredReasons: [],
    outcome: null,
    projectPath: null,
    error: null,
    lastCompletedStep: "",
    clarification: null,
    summaryMessage: null,
  });
  render();

  const ev = new EventSource(`/api/events/${encodeURIComponent(jobId)}`);
  currentSource = ev;
  let receivedAny = false;
  ev.addEventListener("message", (m) => {
    receivedAny = true;
    try { handleEvent(JSON.parse(m.data)); } catch (err) { console.error("bad event payload", err); }
  });
  ev.addEventListener("error", () => {
    if (ev.readyState === EventSource.CLOSED) {
      if (!receivedAny) {
        state.mode = "error";
        state.error =
          "This mod's session has expired on the server (jobs are kept for 1 hour). Re-run the prompt to rebuild it.";
        render();
      }
      finalizeStream();
    }
  });
}

// Map raw GenerationEvent → friendly step index (0..5).
function stepFor(event) {
  if (event.type === "phase") {
    switch (event.name) {
      case "preflight": return 0;
      case "spec":      return 1;
      case "workspace": return 2;
      case "scaffold":  return 2;
      case "codegen":   return 3;
      case "build":     return 4;
    }
  }
  if (event.type === "preflight")      return 0;
  if (event.type === "spec")           return 1;
  if (event.type === "workspace")      return 2;
  if (event.type === "scaffold:done")  return 2;
  if (event.type === "codegen:done")   return 3;
  if (event.type === "build:start")    return 4;
  if (event.type === "build:result")   return 4;
  if (event.type === "repair:start")   return 4;
  return -1;
}

function advanceTo(idx) {
  if (idx < 0) return;
  // Mark all earlier steps done with rough timing; mark idx active.
  if (idx > state.stepIdx) {
    const now = Date.now();
    const elapsed = now - state.currentStepStarted;
    if (state.stepIdx >= 0 && state.stepIdx < STEP_DEFS.length) {
      state.stepTimes[state.stepIdx] = (state.stepTimes[state.stepIdx] || 0) + elapsed;
    }
    state.stepIdx = idx;
    state.currentStepStarted = now;
    state.lastCompletedStep = STEP_DEFS[Math.max(0, idx - 1)]?.label || "";
  }
}

function handleEvent(e) {
  // Update progress.
  const idx = stepFor(e);
  if (idx >= 0) advanceTo(idx);

  // Capture event-specific data.
  switch (e.type) {
    case "spec":
      state.spec = e.spec;
      break;
    case "workspace":
      state.projectPath = e.projectPath;
      break;
    case "codegen:done":
      state.written = Array.isArray(e.written) ? e.written.slice() : [];
      state.uncoveredReasons = Array.isArray(e.uncoveredReasons) ? e.uncoveredReasons.slice() : [];
      break;
    case "build:chunk":
      appendBuildLog(e.chunk);
      break;
    case "done": {
      // Mark all 6 steps done.
      const now = Date.now();
      if (state.stepIdx < STEP_DEFS.length) {
        state.stepTimes[state.stepIdx] = (state.stepTimes[state.stepIdx] || 0) + (now - state.currentStepStarted);
      }
      // Add a small synthetic "polish" duration so the UI shows step 5 with a time.
      state.stepTimes[STEP_DEFS.length - 1] = state.stepTimes[STEP_DEFS.length - 1] || 200;
      state.stepIdx = STEP_DEFS.length;
      state.outcome = e.outcome;
      state.projectPath = e.projectPath ?? state.projectPath;
      state.mode = e.outcome?.success ? "success" : "error";
      if (!e.outcome?.success) {
        state.error = `Build failed: ${e.outcome?.finalReason ?? "unknown"}`;
      }
      finalizeStream();
      break;
    }
    case "error":
      state.mode = "error";
      state.error = e.error || "Unknown error";
      finalizeStream();
      break;
  }
  render();
}

function appendBuildLog(chunk) {
  let next = state.buildLog + chunk;
  if (next.length > MAX_LOG_CHARS) {
    const keep = MAX_LOG_CHARS - TRUNCATION_NOTE.length;
    next = TRUNCATION_NOTE + next.slice(next.length - keep);
  }
  state.buildLog = next;
  // Lightweight update: only re-render the log node if open, otherwise just store.
  const pre = document.querySelector(".logs-body pre");
  if (pre) {
    pre.textContent = next;
    pre.scrollTop = pre.scrollHeight;
  }
  // Update the size label too without a full render.
  const meta = document.querySelector(".logs-head .meta");
  if (meta) meta.textContent = `${Math.round(next.length / 1024)} KB`;
}

function resetToEmpty() {
  finalizeStream();
  Object.assign(state, {
    mode: "empty",
    prompt: "",
    submittedPrompt: "",
    jobId: null,
    stepIdx: 0,
    stepTimes: STEP_DEFS.map(() => 0),
    logsOpen: false,
    advOpen: false,
    buildLog: "",
    spec: null,
    written: [],
    uncoveredReasons: [],
    outcome: null,
    projectPath: null,
    error: null,
    lastCompletedStep: "",
  });
  render();
}

// ---------- helper buttons (reveal / open) ----------

async function callHelper(btn, mode) {
  const id = state.jobId;
  if (!id) {
    btn.textContent = "Job id missing";
    return;
  }
  const url = mode === "reveal"
    ? `/api/reveal/${encodeURIComponent(id)}`
    : `/api/open/${encodeURIComponent(id)}`;
  const orig = btn.innerHTML;
  btn.disabled = true;
  let staleHint = false;
  try {
    const r = await fetch(url, { method: "POST" });
    if (r.ok) {
      btn.textContent = mode === "reveal" ? "Revealed ✓" : "Opened ✓";
    } else {
      let detail = "";
      try { detail = (await r.json()).error ?? ""; } catch { /* */ }
      if (r.status === 404 && /^not found$/i.test(detail)) {
        staleHint = true;
        btn.textContent = "Server stale — restart npm run web";
      } else {
        btn.textContent = `Failed (${r.status})`;
      }
    }
  } catch (e) {
    btn.textContent = "Network error";
  }
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.disabled = false;
  }, staleHint ? 6000 : 2200);
}

// ---------- boot ----------

init();

import { api } from "./api.js";
import { GAME_TITLES } from "./game-titles.js";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const modal = $("#modal");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ROLE_LABEL = { super_admin: "Super admin", scheduler: "Scheduler", employee: "Crew" };
const CREW_ROLES = ["Host", "Game Leader", "Scorekeeper", "Co-host"];
const COLORS = ["pink", "orange", "yellow", "blue", "green", "gray"];
const PAYMENT = ["", "PayPal", "Wise", "Bank transfer", "Revolut", "Payoneer", "Other"];
const ROW_MIN = 15;

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (d) => new Date(d).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const fmtLongDay = (d) => new Date(d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const endOf = (g) => new Date(new Date(g.starts_at).getTime() + g.duration_min * 60000);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const overlaps = (a, b) => new Date(a.starts_at) < endOf(b) && new Date(b.starts_at) < endOf(a);

function toast(text, isErr = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), isErr ? 5000 : 2500);
}

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

// ------------------------------------------------------------------ state
const state = { me: null, profiles: [], details: [], recovering: false };
const canSchedule = () => state.me && state.me.active && ["super_admin", "scheduler"].includes(state.me.role);
const isSuper = () => state.me && state.me.active && state.me.role === "super_admin";
const nameOf = (id) => {
  const p = state.profiles.find((x) => x.id === id);
  return p ? `${p.first_name} ${p.last_name}`.trim() || p.email : "Former crew member";
};
const crew = () => state.profiles.filter((p) => p.active)
  .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));

// ------------------------------------------------------------------ auth screens
const brand = `<div class="brand"><img src="assets/logo.svg" alt=""><div><b>Backstage</b><span>High Five Games crew</span></div></div>`;

function authScreen(mode, note = "") {
  const forms = {
    signin: `<h1>Sign in</h1>
      <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
      <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn" type="submit">Sign in</button>
      <div class="auth-links"><button type="button" class="link" data-go="signup">Create an account</button><button type="button" class="link" data-go="forgot">Forgot password?</button></div>`,
    signup: `<h1>Create your account</h1>
      <div class="form-grid">
        <label class="field">First name<input name="first" autocomplete="given-name" required></label>
        <label class="field">Last name<input name="last" autocomplete="family-name" required></label>
      </div>
      <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
      <label class="field">Password <small>at least 8 characters</small><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn" type="submit">Create account</button>
      <p class="dim" style="margin:0;font-size:13px">A super admin approves new accounts before you can see the schedule.</p>
      <div class="auth-links"><button type="button" class="link" data-go="signin">I already have an account</button></div>`,
    forgot: `<h1>Reset your password</h1>
      <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
      <button class="btn" type="submit">Send reset link</button>
      <div class="auth-links"><button type="button" class="link" data-go="signin">Back to sign in</button></div>`,
    reset: `<h1>Choose a new password</h1>
      <label class="field">New password <small>at least 8 characters</small><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn" type="submit">Save password</button>`,
  };
  app.innerHTML = `<div class="auth"><form class="auth-card" novalidate>${brand}${forms[mode]}<p class="msg" hidden></p></form></div>`;
  const form = $("form", app);
  const msg = $(".msg", form);
  const show = (text, kind) => { msg.textContent = text; msg.className = `msg ${kind}`; msg.hidden = false; };
  if (note) show(note, "ok");
  $$("[data-go]", form).forEach((b) => (b.onclick = () => authScreen(b.dataset.go)));
  $("input", form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { show("Please fill in every field (passwords need at least 8 characters).", "err"); return; }
    const f = form.elements;
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      if (mode === "signin") await api.signIn(f.email.value.trim(), f.password.value);
      if (mode === "signup") {
        const { needsConfirmation } = await api.signUp(f.email.value.trim(), f.password.value, f.first.value.trim(), f.last.value.trim());
        if (needsConfirmation) { authScreen("signin", "Almost there! Check your email and click the confirmation link, then sign in. A super admin will approve your account."); return; }
      }
      if (mode === "forgot") { await api.sendReset(f.email.value.trim()); show("If that email has an account, a reset link is on its way.", "ok"); btn.disabled = false; return; }
      if (mode === "reset") { await api.setPassword(f.password.value); state.recovering = false; history.replaceState(null, "", location.pathname + location.search); toast("Password updated"); }
      await boot();
    } catch (err) {
      show(friendlyError(err), "err");
      btn.disabled = false;
    }
  };
}

function friendlyError(err) {
  const m = err.message || String(err);
  if (/invalid login/i.test(m)) return "That email and password don't match.";
  if (/email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for the link.";
  if (/already registered/i.test(m)) return "There's already an account with that email. Try signing in.";
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  if (/rate limit/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
  return m;
}

// ------------------------------------------------------------------ boot & shell
async function boot() {
  if (state.recovering) { authScreen("reset"); return; }
  const session = await api.session();
  if (!session) { authScreen("signin"); return; }
  try {
    state.me = await api.me();
  } catch (err) {
    app.innerHTML = `<div class="auth"><div class="auth-card">${brand}<p class="msg err">Couldn't load your account: ${esc(err.message)}</p><button class="btn" id="out">Sign out</button></div></div>`;
    $("#out").onclick = () => api.signOut();
    return;
  }
  if (!state.me.active) { pendingScreen(); return; }
  await loadCrew();
  shell();
  route();
}

async function loadCrew() {
  [state.profiles, state.details] = await Promise.all([api.profiles(), api.details()]);
}

function pendingScreen() {
  app.innerHTML = `<div class="auth"><div class="auth-card">${brand}
    <h1>Thanks, ${esc(state.me.first_name || "there")}!</h1>
    <p>Your account is waiting for approval. A super admin will let you in shortly. Then you'll see the schedule here.</p>
    <span class="badge pending" style="justify-self:start">Pending approval</span>
    <div class="auth-links"><button class="btn btn-ghost btn-sm" id="refresh">Check again</button><button class="link" id="out">Sign out</button></div>
  </div></div>`;
  $("#refresh").onclick = boot;
  $("#out").onclick = () => api.signOut();
}

const NAV = [
  ["showtimes", "Showtimes", () => true],
  ["games", "Games", () => true],
  ["mine", "My games", () => true],
  ["crew", "Crew", () => canSchedule()],
  ["profile", "Profile", () => true],
];

function shell() {
  app.innerHTML = `<header class="top"><div class="top-inner">
      <a class="brand" href="#/showtimes"><img src="assets/logo.svg" alt=""><div><b>Backstage</b><span>High Five Games</span></div></a>
      <nav class="nav" aria-label="Main">${NAV.filter(([, , ok]) => ok()).map(([k, l]) => `<a href="#/${k}" data-k="${k}">${l}</a>`).join("")}</nav>
      <div class="who"><span class="name">${esc(nameOf(state.me.id))}</span><span class="badge ${state.me.role}">${ROLE_LABEL[state.me.role]}</span>
        <button class="btn btn-ghost btn-sm" id="signout">Sign out</button></div>
    </div></header>
    ${api.demo ? '<p class="msg warn" style="margin:12px 20px 0">Demo mode: sample data only, nothing is saved.</p>' : ""}
    <main id="view"></main>`;
  $("#signout").onclick = () => api.signOut();
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h || h.includes("access_token") || h.includes("error=")) return { name: "showtimes", params: new URLSearchParams() };
  const [name, qs] = h.split("?");
  return { name, params: new URLSearchParams(qs || "") };
}

// Each navigation gets a number; a screen whose data arrives after the user has moved on is dropped,
// so a slow load can't draw over the page they're now on.
let routeSeq = 0;
const isStale = (seq) => seq !== routeSeq;

async function route() {
  if (!state.me || !$("#view")) return;
  const seq = ++routeSeq;
  const { name, params } = parseRoute();
  const view = NAV.find(([k, , ok]) => k === name && ok()) ? name : "showtimes";
  $$(".nav a").forEach((a) => (a.dataset.k === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const el = $("#view");
  el.innerHTML = '<p class="dim">Loading…</p>';
  try {
    await ({ showtimes, games: gamesView, mine: mineView, crew: crewView, profile: profileView })[view](el, params, seq);
  } catch (err) {
    if (isStale(seq)) return;
    el.innerHTML = `<p class="msg err">Something went wrong: ${esc(friendlyError(err))}</p>`;
  }
}

// ------------------------------------------------------------------ Showtimes (schedule grid)
async function showtimes(el, params, seq) {
  const day = params.get("d") ? parseYmd(params.get("d")) : startOfDay(new Date());
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  // include games from the evening before that run past midnight
  const games = (await api.games(new Date(dayStart.getTime() - 8 * 3600e3).toISOString(), dayEnd.toISOString()))
    .filter((g) => endOf(g) > dayStart);
  if (isStale(seq)) return;
  const cols = [{ id: null, label: "Unscheduled" }, ...crew().map((p) => ({ id: p.id, label: nameOf(p.id) }))];
  const rows = (24 * 60) / ROW_MIN;
  const go = (d) => `#/showtimes?d=${ymd(d)}`;

  el.innerHTML = `<div class="toolbar">
      <a class="btn btn-ghost btn-sm" href="${go(addDays(dayStart, -1))}" aria-label="Previous day">${icon("left")}</a>
      <a class="btn btn-ghost btn-sm" href="${go(startOfDay(new Date()))}">Today</a>
      <a class="btn btn-ghost btn-sm" href="${go(addDays(dayStart, 1))}" aria-label="Next day">${icon("right")}</a>
      <input type="date" id="pick" value="${ymd(dayStart)}" aria-label="Jump to date">
      <span class="date-label">${fmtLongDay(dayStart)}</span>
      <span class="spacer"></span>
      <span class="tz">Times in your time zone (${esc(TZ)})</span>
      ${canSchedule() ? `<button class="btn btn-sm" id="new">${icon("plus")} New game</button>` : ""}
    </div>
    <div class="grid-wrap"><div class="grid" style="grid-template-columns: 72px repeat(${cols.length}, minmax(170px, 1fr))">
      <div class="g-head corner">Time</div>
      ${cols.map((c) => `<div class="g-head ${c.id ? "" : "unsched"} ${c.id === state.me.id ? "me" : ""}" title="${esc(c.label)}">${esc(c.label)}</div>`).join("")}
      <div class="g-times" style="height:calc(var(--row) * ${rows})">${Array.from({ length: 24 }, (_, h) => `<div>${fmtTime(new Date(2000, 0, 1, h))}</div>`).join("")}</div>
      ${cols.map((c, i) => `<div class="g-col ${c.id ? "" : "unsched"} ${canSchedule() ? "clickable" : ""}" data-col="${i}" style="height:calc(var(--row) * ${rows})"></div>`).join("")}
    </div></div>
    ${games.length ? "" : '<p class="empty-day">No games on this day yet.</p>'}`;

  $("#pick").onchange = (e) => e.target.value && (location.hash = `#/showtimes?d=${e.target.value}`);
  if ($("#new")) $("#new").onclick = () => editGame(null, { starts_at: new Date(dayStart.getTime() + 9 * 3600e3) });

  const rowPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row"));
  const colEls = $$(".g-col", el);
  cols.forEach((c, i) => {
    const mineIn = games.filter((g) => (c.id ? g.assignments.some((a) => a.user_id === c.id) : g.assignments.length === 0));
    layoutLanes(mineIn).forEach(({ g, lane, lanes }) => {
      const start = Math.max(0, (new Date(g.starts_at) - dayStart) / 60000);
      const end = Math.min(24 * 60, (endOf(g) - dayStart) / 60000);
      const a = c.id && g.assignments.find((x) => x.user_id === c.id);
      const b = document.createElement("div");
      b.className = `block c-${g.color} ${g.assignments.some((x) => x.user_id === state.me.id) ? "mine" : ""}`;
      b.style.top = `${(start / ROW_MIN) * rowPx + 1}px`;
      b.style.height = `${Math.max(((end - start) / ROW_MIN) * rowPx - 2, rowPx - 2)}px`;
      b.style.left = `calc(${(100 / lanes) * lane}% + 2px)`;
      b.style.width = `calc(${100 / lanes}% - 4px)`;
      b.innerHTML = `<b>${esc(g.client)}</b>${esc(g.booking_ref)}<br>${esc(g.game)}<br>${g.players ? `${g.players}pax<br>` : ""}${fmtTime(g.starts_at)}${a ? `<br>${esc(a.role)}` : ""}`;
      b.title = `${g.client} · ${g.game} · ${fmtTime(g.starts_at)}–${fmtTime(endOf(g))}`;
      b.onclick = (e) => { e.stopPropagation(); openGame(g); };
      colEls[i].append(b);
    });
    if (canSchedule()) {
      colEls[i].onclick = (e) => {
        const mins = Math.floor((e.offsetY / rowPx)) * ROW_MIN;
        editGame(null, { starts_at: new Date(dayStart.getTime() + mins * 60000), user_id: c.id });
      };
    }
  });

  // red "now" line on today
  const now = new Date();
  if (now >= dayStart && now < dayEnd) {
    colEls.forEach((c) => { const l = document.createElement("div"); l.className = "g-now"; l.style.top = `${((now - dayStart) / 60000 / ROW_MIN) * rowPx}px`; c.append(l); });
  }
  // scroll to the first game (or 8am)
  const first = games.length ? Math.max(0, (new Date(games[0].starts_at) - dayStart) / 60000) : 8 * 60;
  $(".grid-wrap", el).scrollTop = Math.max(0, (first / ROW_MIN) * rowPx - rowPx * 2);
}

// Side-by-side lanes for overlapping games in one column.
function layoutLanes(games) {
  const sorted = [...games].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const out = [];
  let cluster = [], clusterEnd = 0, laneEnds = [];
  const flush = () => { const lanes = laneEnds.length || 1; cluster.forEach((x) => out.push({ ...x, lanes })); cluster = []; laneEnds = []; };
  for (const g of sorted) {
    const s = new Date(g.starts_at).getTime(), e = endOf(g).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    cluster.push({ g, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ Game details / editor
function openModal(html) {
  modal.innerHTML = html;
  if (!modal.open) modal.showModal();
  $$("[data-close]", modal).forEach((b) => (b.onclick = () => modal.close()));
}
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

function crewList(g) {
  if (!g.assignments.length) return '<span class="badge pending">Unscheduled</span>';
  return g.assignments.map((a) => `${esc(nameOf(a.user_id))} <span class="dim">· ${esc(a.role)}</span>`).join("<br>");
}

function openGame(g) {
  openModal(`<div class="m-head"><h2>${esc(g.client)}</h2><button class="m-close" data-close aria-label="Close">×</button></div>
    <div class="m-body"><dl class="facts">
      <dt>Game</dt><dd>${esc(g.game)}</dd>
      <dt>Booking</dt><dd>${esc(g.booking_ref) || "—"}</dd>
      <dt>When</dt><dd>${fmtLongDay(g.starts_at)}<br>${fmtTime(g.starts_at)}–${fmtTime(endOf(g))} <span class="dim">(${g.duration_min} min)</span></dd>
      <dt>Players</dt><dd>${g.players ?? "—"}</dd>
      <dt>Crew</dt><dd>${crewList(g)}</dd>
      ${g.notes ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(g.notes)}</dd>` : ""}
    </dl></div>
    <div class="m-foot">${canSchedule() ? '<button class="btn" id="edit">Edit game</button>' : ""}<button class="btn btn-ghost" data-close>Close</button></div>`);
  if ($("#edit", modal)) $("#edit", modal).onclick = () => editGame(g);
}

function editGame(g, preset = {}) {
  const isNew = !g;
  g = g || { client: "", booking_ref: "", game: "", players: "", starts_at: preset.starts_at.toISOString(), duration_min: 60, color: "pink", notes: "",
             assignments: preset.user_id ? [{ user_id: preset.user_id, role: "Host" }] : [] };
  const start = new Date(g.starts_at);
  const people = crew();
  const crewRow = (a = { user_id: "", role: "Host" }) => `<div class="crew-row">
      <select name="crew_user" aria-label="Crew member"><option value="">Choose…</option>${people.map((p) => `<option value="${p.id}" ${p.id === a.user_id ? "selected" : ""}>${esc(nameOf(p.id))}</option>`).join("")}</select>
      <select name="crew_role" aria-label="Role">${CREW_ROLES.map((r) => `<option ${r === a.role ? "selected" : ""}>${r}</option>`).join("")}</select>
      <button type="button" class="rm" aria-label="Remove">×</button></div>`;

  openModal(`<form id="gf" novalidate>
    <div class="m-head"><h2>${isNew ? "New game" : "Edit game"}</h2><button type="button" class="m-close" data-close aria-label="Close">×</button></div>
    <div class="m-body">
      <div class="form-grid">
        <label class="field wide">Client<input name="client" value="${esc(g.client)}" required placeholder="Company name"></label>
        <label class="field">Game<input name="game" list="titles" value="${esc(g.game)}" required placeholder="e.g. Fabulous Feud"></label>
        <label class="field">Booking #<input name="booking_ref" value="${esc(g.booking_ref)}" placeholder="e.g. B1411"></label>
        <label class="field">Date<input name="date" type="date" value="${ymd(start)}" required></label>
        <label class="field">Start time<input name="time" type="time" step="900" value="${hhmm(start)}" required></label>
        <label class="field">Length<select name="duration_min">${[30, 45, 60, 75, 90, 120].map((m) => `<option value="${m}" ${m === g.duration_min ? "selected" : ""}>${m} minutes</option>`).join("")}
          ${[30, 45, 60, 75, 90, 120].includes(g.duration_min) ? "" : `<option value="${g.duration_min}" selected>${g.duration_min} minutes</option>`}</select></label>
        <label class="field">Players<input name="players" type="number" min="1" inputmode="numeric" value="${esc(g.players ?? "")}"></label>
        <div class="field wide"><span>Color</span><div class="swatches">${COLORS.map((c) => `<label title="${c}"><input type="radio" name="color" value="${c}" ${c === g.color ? "checked" : ""}><span class="c-${c}"></span></label>`).join("")}</div></div>
        <div class="field wide"><span>Crew</span><div class="crew-rows">${g.assignments.map(crewRow).join("")}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addcrew" style="justify-self:start">${icon("plus")} Add crew</button></div>
        <label class="field wide">Notes<textarea name="notes" rows="3">${esc(g.notes)}</textarea></label>
      </div>
      <p class="msg warn" id="conflicts" hidden></p>
      <p class="msg err" id="err" hidden></p>
      <datalist id="titles">${GAME_TITLES.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
    </div>
    <div class="m-foot">${isNew ? "" : '<button type="button" class="btn btn-danger left" id="del">Delete</button>'}
      <button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn" type="submit">${isNew ? "Add game" : "Save changes"}</button></div>
  </form>`);

  const form = $("#gf", modal);
  const rowsEl = $(".crew-rows", form);
  const wireRemove = () => $$(".rm", rowsEl).forEach((b) => (b.onclick = () => { b.closest(".crew-row").remove(); checkConflicts(); }));
  $("#addcrew", form).onclick = () => { rowsEl.insertAdjacentHTML("beforeend", crewRow()); wireRemove(); };
  wireRemove();

  const collect = () => {
    const f = form.elements;
    const [y, mo, d] = f.date.value.split("-").map(Number);
    const [h, mi] = (f.time.value || "00:00").split(":").map(Number);
    const assignments = $$(".crew-row", rowsEl).map((r) => ({ user_id: $("[name=crew_user]", r).value, role: $("[name=crew_role]", r).value })).filter((a) => a.user_id);
    return {
      game: { id: g.id, client: f.client.value.trim(), booking_ref: f.booking_ref.value.trim(), game: f.game.value.trim(),
              players: f.players.value ? parseInt(f.players.value, 10) : null, starts_at: f.date.value ? new Date(y, mo - 1, d, h, mi).toISOString() : null,
              duration_min: parseInt(f.duration_min.value, 10), color: f.color.value || "pink", notes: f.notes.value.trim() },
      assignments,
    };
  };

  // Warn (don't block) when someone is double-booked.
  async function checkConflicts() {
    const { game, assignments } = collect();
    const box = $("#conflicts", form);
    if (!game.starts_at || !assignments.length) { box.hidden = true; return; }
    const s = new Date(game.starts_at);
    const near = await api.games(new Date(s.getTime() - 12 * 3600e3).toISOString(), new Date(s.getTime() + 12 * 3600e3).toISOString());
    const warnings = [];
    for (const a of assignments) {
      for (const o of near) {
        if (o.id === game.id || !o.assignments.some((x) => x.user_id === a.user_id)) continue;
        if (overlaps(game, o)) warnings.push(`${nameOf(a.user_id)} is already on ${o.client} (${o.game}) ${fmtTime(o.starts_at)}–${fmtTime(endOf(o))}`);
      }
    }
    const dupes = assignments.map((a) => a.user_id).filter((id, i, arr) => arr.indexOf(id) !== i);
    if (dupes.length) warnings.push(`${nameOf(dupes[0])} is listed twice`);
    box.innerHTML = warnings.map((w) => `⚠ ${esc(w)}`).join("<br>");
    box.hidden = !warnings.length;
  }
  form.addEventListener("change", checkConflicts);
  checkConflicts();

  if ($("#del", form)) $("#del", form).onclick = async () => {
    if (!confirm(`Delete ${g.client} – ${g.game}? This can't be undone.`)) return;
    try { await api.deleteGame(g.id); modal.close(); toast("Game deleted"); route(); }
    catch (err) { showErr(friendlyError(err)); }
  };

  const showErr = (t) => { const e = $("#err", form); e.textContent = t; e.hidden = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { game, assignments } = collect();
    if (!game.client || !game.game || !game.starts_at) { showErr("Client, game, date and start time are required."); return; }
    if (new Set(assignments.map((a) => a.user_id)).size !== assignments.length) { showErr("Each crew member can only be listed once per game."); return; }
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await api.saveGame(game, assignments);
      modal.close();
      toast(isNew ? "Game added" : "Game saved");
      route();
    } catch (err) { showErr(friendlyError(err)); btn.disabled = false; }
  };
}

// ------------------------------------------------------------------ Games list
function gameItem(g) {
  const open = !g.assignments.length;
  return `<div class="item bl-${g.color}" data-id="${g.id}" tabindex="0" role="button">
    <div class="when"><b>${fmtDay(g.starts_at)}</b><span class="dim">${fmtTime(g.starts_at)}–${fmtTime(endOf(g))}</span></div>
    <div class="what"><b>${esc(g.client)}</b> <span class="dim">· ${esc(g.game)}${g.booking_ref ? ` · ${esc(g.booking_ref)}` : ""}${g.players ? ` · ${g.players}pax` : ""}</span>
      <div class="crew">${open ? "No crew yet" : g.assignments.map((a) => `${esc(nameOf(a.user_id))} (${esc(a.role)})`).join(", ")}</div></div>
    <span class="tag ${open ? "open" : ""}">${open ? "Unscheduled" : `${g.assignments.length} crew`}</span></div>`;
}

function wireItems(el, games) {
  $$(".item", el).forEach((it) => {
    const g = games.find((x) => String(x.id) === it.dataset.id);
    it.onclick = () => openGame(g);
    it.onkeydown = (e) => { if (e.key === "Enter") openGame(g); };
  });
}

async function gamesView(el, params, seq) {
  const tab = params.get("tab") || "upcoming";
  const now = new Date();
  const games = tab === "past"
    ? (await api.games(addDays(now, -120).toISOString(), now.toISOString())).reverse()
    : await api.games(now.toISOString(), null);
  if (isStale(seq)) return;
  const list = tab === "unscheduled" ? games.filter((g) => !g.assignments.length) : games;
  el.innerHTML = `<div class="page-head"><h1>Games</h1>${canSchedule() ? `<button class="btn btn-sm" id="new">${icon("plus")} New game</button>` : ""}</div>
    <div class="toolbar"><div class="tabs">${[["upcoming", "Upcoming"], ["unscheduled", "Unscheduled"], ["past", "Past"]].map(([k, l]) =>
      `<a class="tab" href="#/games?tab=${k}" aria-pressed="${k === tab}" style="text-decoration:none">${l}</a>`).join("")}</div>
      <span class="spacer"></span><input type="search" id="q" placeholder="Search client, game or booking #" style="max-width:300px"></div>
    <div class="list" id="list">${list.map(gameItem).join("") || '<p class="none">No games here.</p>'}</div>`;
  wireItems(el, list);
  if ($("#new")) $("#new").onclick = () => editGame(null, { starts_at: (() => { const d = addDays(startOfDay(now), 1); d.setHours(9); return d; })() });
  $("#q").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$(".item", el).forEach((it) => (it.hidden = q && !it.textContent.toLowerCase().includes(q)));
  };
}

// ------------------------------------------------------------------ My games
async function mineView(el, params, seq) {
  const all = await api.games(null, null);
  if (isStale(seq)) return;
  const mine = all.filter((g) => g.assignments.some((a) => a.user_id === state.me.id));
  const now = new Date();
  const upcoming = mine.filter((g) => endOf(g) >= now);
  const past = mine.filter((g) => endOf(g) < now).reverse();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = mine.filter((g) => new Date(g.starts_at) >= monthStart && new Date(g.starts_at) < new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const open = all.filter((g) => !g.assignments.length && new Date(g.starts_at) >= now);
  const roleIn = (g) => g.assignments.find((a) => a.user_id === state.me.id).role;
  const item = (g) => gameItem(g).replace(/<span class="tag[^"]*">[^<]*<\/span>/, `<span class="tag">${esc(roleIn(g))}</span>`);
  el.innerHTML = `<div class="page-head"><h1>My games</h1></div>
    <div class="stats">
      <div class="stat"><b>${upcoming.length}</b><span>upcoming</span></div>
      <div class="stat"><b>${thisMonth.length}</b><span>this month</span></div>
      <div class="stat"><b>${past.length}</b><span>played in total</span></div>
      <div class="stat"><b>${open.length}</b><span>open games still need crew</span></div>
    </div>
    <h2 class="section-title">Upcoming</h2>
    <div class="list" id="up">${upcoming.map(item).join("") || '<p class="none">Nothing scheduled for you yet.</p>'}</div>
    <h2 class="section-title">History</h2>
    <div class="list" id="hist">${past.map(item).join("") || '<p class="none">No past games yet.</p>'}</div>`;
  wireItems(el, mine);
}

// ------------------------------------------------------------------ Profile
async function profileView(el, params, seq) {
  const d = await api.myDetails(state.me.id);
  if (isStale(seq)) return;
  el.innerHTML = `<div class="page-head"><h1>Your profile</h1></div>
    <form class="card" id="pf" style="max-width:640px;display:grid;gap:16px" novalidate>
      <div class="form-grid">
        <label class="field">First name<input name="first" value="${esc(state.me.first_name)}" required autocomplete="given-name"></label>
        <label class="field">Last name<input name="last" value="${esc(state.me.last_name)}" required autocomplete="family-name"></label>
        <label class="field">Email<input value="${esc(state.me.email)}" readonly></label>
        <label class="field">Phone<input name="phone" type="tel" value="${esc(d.phone)}" autocomplete="tel" placeholder="+1 555 123 4567"></label>
        <label class="field">Preferred payment method<select name="payment_method">${PAYMENT.map((p) => `<option value="${p}" ${p === d.payment_method ? "selected" : ""}>${p || "Choose…"}</option>`).join("")}</select></label>
        <label class="field">Payout email or handle <small>optional</small><input name="payout_handle" value="${esc(d.payout_handle)}" placeholder="e.g. your PayPal email"></label>
      </div>
      <p class="dim" style="margin:0;font-size:13px">Only you, schedulers and super admins can see your phone and payment details. Never enter bank account or card numbers here.</p>
      <p class="msg" hidden></p>
      <button class="btn" type="submit" style="justify-self:start">Save profile</button>
    </form>
    <form class="card" id="pw" style="max-width:640px;display:grid;gap:14px;margin-top:18px" novalidate>
      <h2 style="font-size:18px">Change password</h2>
      <label class="field">New password <small>at least 8 characters</small><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="msg" hidden></p>
      <button class="btn btn-ghost" type="submit" style="justify-self:start">Update password</button>
    </form>`;
  const say = (form, t, kind) => { const m = $(".msg", form); m.textContent = t; m.className = `msg ${kind}`; m.hidden = false; };
  const pf = $("#pf", el);
  pf.onsubmit = async (e) => {
    e.preventDefault();
    const f = pf.elements;
    if (!f.first.value.trim() || !f.last.value.trim()) { say(pf, "First and last name are required.", "err"); return; }
    try {
      await api.updateMyName(state.me.id, f.first.value.trim(), f.last.value.trim());
      await api.updateMyDetails(state.me.id, { phone: f.phone.value.trim(), payment_method: f.payment_method.value, payout_handle: f.payout_handle.value.trim() });
      state.me = await api.me();
      await loadCrew();
      $(".who .name").textContent = nameOf(state.me.id);
      say(pf, "Saved.", "ok");
    } catch (err) { say(pf, friendlyError(err), "err"); }
  };
  const pw = $("#pw", el);
  pw.onsubmit = async (e) => {
    e.preventDefault();
    if (!pw.checkValidity()) { say(pw, "Passwords need at least 8 characters.", "err"); return; }
    try { await api.setPassword(pw.elements.password.value); pw.reset(); say(pw, "Password updated.", "ok"); }
    catch (err) { say(pw, friendlyError(err), "err"); }
  };
}

// ------------------------------------------------------------------ Crew (schedulers see, super admins manage)
async function crewView(el, params, seq) {
  await loadCrew();
  if (isStale(seq)) return;
  const det = Object.fromEntries(state.details.map((d) => [d.id, d]));
  const people = [...state.profiles].sort((a, b) => (a.active - b.active) || nameOf(a.id).localeCompare(nameOf(b.id)));
  const pendingCount = people.filter((p) => !p.active).length;
  el.innerHTML = `<div class="page-head"><h1>Crew</h1>${pendingCount && isSuper() ? `<span class="badge pending">${pendingCount} waiting for approval</span>` : ""}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Payment</th><th>Role</th><th>Status</th>${isSuper() ? "<th></th>" : ""}</tr></thead>
      <tbody>${people.map((p) => {
        const d = det[p.id] || {};
        const roleCell = isSuper()
          ? `<select data-role="${p.id}" aria-label="Role for ${esc(nameOf(p.id))}">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${k === p.role ? "selected" : ""}>${l}</option>`).join("")}</select>`
          : `<span class="badge ${p.role}">${ROLE_LABEL[p.role]}</span>`;
        const action = !isSuper() || p.id === state.me.id ? "" : p.active
          ? `<button class="btn btn-ghost btn-sm" data-toggle="${p.id}">Deactivate</button>`
          : `<button class="btn btn-sm" data-toggle="${p.id}">Approve</button>`;
        return `<tr class="${p.active ? "" : "pending-row"}">
          <td><b>${esc(nameOf(p.id))}</b>${p.id === state.me.id ? ' <span class="dim">(you)</span>' : ""}</td>
          <td>${esc(p.email)}</td><td>${esc(d.phone || "—")}</td>
          <td>${esc(d.payment_method || "—")}${d.payout_handle ? `<br><span class="dim">${esc(d.payout_handle)}</span>` : ""}</td>
          <td>${roleCell}</td>
          <td>${p.active ? "Active" : '<span class="badge pending">Pending</span>'}</td>
          ${isSuper() ? `<td>${action}</td>` : ""}</tr>`;
      }).join("")}</tbody></table></div>
    <p class="dim" style="font-size:13px;margin-top:12px">${isSuper()
      ? "New sign-ups appear here as Pending. Approve them to give access; change roles with the dropdown."
      : "Only super admins can approve accounts or change roles."}</p>`;

  const update = async (id, role, active) => {
    try { await api.adminUpdateUser(id, role, active); toast("Crew updated"); route(); }
    catch (err) { toast(friendlyError(err), true); route(); }
  };
  $$("[data-role]", el).forEach((s) => (s.onchange = () => {
    const p = state.profiles.find((x) => x.id === s.dataset.role);
    update(p.id, s.value, p.active);
  }));
  $$("[data-toggle]", el).forEach((b) => (b.onclick = () => {
    const p = state.profiles.find((x) => x.id === b.dataset.toggle);
    if (p.active && !confirm(`Deactivate ${nameOf(p.id)}? They won't be able to see the schedule.`)) return;
    update(p.id, p.role, !p.active);
  }));
}

// ------------------------------------------------------------------ start
api.onAuthChange((event) => {
  if (event === "PASSWORD_RECOVERY") { state.recovering = true; authScreen("reset"); return; }
  if (event === "SIGNED_OUT") { state.me = null; modal.open && modal.close(); authScreen("signin"); }
});
window.addEventListener("hashchange", () => { if (modal.open) modal.close(); route(); });
if (/type=recovery/.test(location.hash)) state.recovering = true;
boot().catch((err) => { app.innerHTML = `<p class="msg err" style="margin:20px">Couldn't start Backstage: ${esc(err.message)}</p>`; });

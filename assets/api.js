// Data layer. Everything the UI needs from the backend goes through `api`, so the app can run
// against Supabase (normal) or an in-memory demo backend (open the site with ?demo).

const GAME_COLS = "id, client, booking_ref, game, players, starts_at, duration_min, color, notes, assignments(user_id, role)";

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function supabaseApi() {
  const { supabaseUrl, supabaseAnonKey } = window.BACKSTAGE_CONFIG;
  const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  const redirect = location.origin + location.pathname;

  return {
    demo: false,
    async session() { return check(await sb.auth.getSession()).session; },
    onAuthChange(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, first_name, last_name) {
      const data = check(await sb.auth.signUp({
        email, password, options: { data: { first_name, last_name }, emailRedirectTo: redirect },
      }));
      return { needsConfirmation: !data.session };
    },
    async signOut() { await sb.auth.signOut(); },
    async sendReset(email) { check(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect })); },
    async setPassword(password) { check(await sb.auth.updateUser({ password })); },

    async me() {
      const { user } = check(await sb.auth.getUser());
      return check(await sb.from("profiles").select("*").eq("id", user.id).single());
    },
    async profiles() { return check(await sb.from("profiles").select("*").order("first_name")); },
    async details() { return check(await sb.from("profile_details").select("*")); },
    async myDetails(id) { return check(await sb.from("profile_details").select("*").eq("id", id).single()); },
    async updateMyName(id, first_name, last_name) {
      check(await sb.from("profiles").update({ first_name, last_name }).eq("id", id));
    },
    async updateMyDetails(id, fields) { check(await sb.from("profile_details").update(fields).eq("id", id)); },
    async adminUpdateUser(id, role, active) {
      check(await sb.rpc("admin_update_user", { target: id, new_role: role, new_active: active }));
    },

    async games(fromIso, toIso) {
      let q = sb.from("games").select(GAME_COLS).order("starts_at");
      if (fromIso) q = q.gte("starts_at", fromIso);
      if (toIso) q = q.lt("starts_at", toIso);
      return check(await q);
    },
    async saveGame(game, assignments) {
      const fields = (({ client, booking_ref, game: g, players, starts_at, duration_min, color, notes }) =>
        ({ client, booking_ref, game: g, players, starts_at, duration_min, color, notes }))(game);
      let id = game.id;
      if (id) check(await sb.from("games").update(fields).eq("id", id));
      else id = check(await sb.from("games").insert(fields).select("id").single()).id;
      check(await sb.from("assignments").delete().eq("game_id", id));
      if (assignments.length) {
        check(await sb.from("assignments").insert(assignments.map((a) => ({ game_id: id, user_id: a.user_id, role: a.role }))));
      }
      return id;
    },
    async deleteGame(id) { check(await sb.from("games").delete().eq("id", id)); },
  };
}

// In-memory backend for trying the app (and for automated tests). Data resets on reload.
function demoApi() {
  const day = (offset, h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString(); };
  const people = [
    ["u1", "admin@demo", "Alex", "Admin", "super_admin"],
    ["u2", "sched@demo", "Sam", "Scheduler", "scheduler"],
    ["u3", "eve@demo", "Eve", "Employee", "employee"],
    ["u4", "jo@demo", "Jo", "Host", "employee"],
    ["u5", "new@demo", "Nia", "Newcomer", "employee", false],
  ];
  const state = {
    profiles: people.map(([id, email, first_name, last_name, role, active = true]) =>
      ({ id, email, first_name, last_name, role, active, created_at: day(-30, 9, 0) })),
    details: people.map(([id]) => ({ id, phone: id === "u3" ? "+1 555 0100" : "", payment_method: id === "u3" ? "PayPal" : "", payout_handle: "" })),
    games: [
      { id: 1, client: "Demo Company", booking_ref: "B1001", game: "Fabulous Feud", players: 25, starts_at: day(0, 9, 0), duration_min: 60, color: "pink", notes: "" },
      { id: 2, client: "Sample Inc", booking_ref: "B1002", game: "Escape Atlantis", players: 18, starts_at: day(0, 10, 30), duration_min: 75, color: "orange", notes: "Custom questions" },
      { id: 3, client: "Example Ltd", booking_ref: "B1003", game: "Trivia Trial", players: 40, starts_at: day(0, 13, 0), duration_min: 45, color: "pink", notes: "" },
      { id: 4, client: "Test Org", booking_ref: "B1004", game: "Holiday Team Jeopardy", players: 12, starts_at: day(1, 15, 0), duration_min: 60, color: "green", notes: "" },
      { id: 5, client: "Old Client", booking_ref: "B0990", game: "Name That Tune", players: 9, starts_at: day(-3, 11, 0), duration_min: 60, color: "pink", notes: "" },
    ],
    assignments: [
      { game_id: 1, user_id: "u2", role: "Host" }, { game_id: 1, user_id: "u3", role: "Scorekeeper" },
      { game_id: 2, user_id: "u4", role: "Game Leader" }, { game_id: 5, user_id: "u3", role: "Host" },
    ],
    nextId: 6,
  };
  const asUser = new URLSearchParams(location.search).get("as") || "u1";
  let signedIn = !new URLSearchParams(location.search).has("signedout");
  const listeners = [];
  const withAssign = (g) => ({ ...g, assignments: state.assignments.filter((a) => a.game_id === g.id).map(({ user_id, role }) => ({ user_id, role })) });
  const me = () => state.profiles.find((p) => p.id === asUser);
  const can = () => me().active && ["super_admin", "scheduler"].includes(me().role);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  return {
    demo: true,
    async session() { return signedIn ? { user: { id: asUser, email: me().email } } : null; },
    onAuthChange(cb) { listeners.push(cb); },
    async signIn() { signedIn = true; listeners.forEach((cb) => cb("SIGNED_IN", { user: { id: asUser } })); },
    async signUp() { return { needsConfirmation: false }; },
    async signOut() { signedIn = false; listeners.forEach((cb) => cb("SIGNED_OUT", null)); },
    async sendReset() {},
    async setPassword() {},
    async me() { return clone(me()); },
    async profiles() { return clone(me().active ? state.profiles : [me()]); },
    async details() { return clone(can() ? state.details : state.details.filter((d) => d.id === asUser)); },
    async myDetails(id) { return clone(state.details.find((d) => d.id === id)); },
    async updateMyName(id, first_name, last_name) { Object.assign(state.profiles.find((p) => p.id === id), { first_name, last_name }); },
    async updateMyDetails(id, fields) { Object.assign(state.details.find((d) => d.id === id), fields); },
    async adminUpdateUser(id, role, active) {
      if (me().role !== "super_admin") throw new Error("Only a super admin can change roles or approve accounts");
      if (id === asUser && (role !== "super_admin" || !active)) throw new Error("You can't remove your own super admin access");
      Object.assign(state.profiles.find((p) => p.id === id), { role, active });
    },
    async games(fromIso, toIso) {
      if (!me().active) return [];
      return clone(state.games.filter((g) => (!fromIso || g.starts_at >= fromIso) && (!toIso || g.starts_at < toIso))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(withAssign));
    },
    async saveGame(game, assignments) {
      if (!can()) throw new Error("new row violates row-level security policy");
      let id = game.id;
      const fields = { ...game }; delete fields.assignments;
      if (id) Object.assign(state.games.find((g) => g.id === id), fields);
      else { id = state.nextId++; state.games.push({ ...fields, id }); }
      state.assignments = state.assignments.filter((a) => a.game_id !== id).concat(assignments.map((a) => ({ ...a, game_id: id })));
      return id;
    },
    async deleteGame(id) {
      if (!can()) throw new Error("not allowed");
      state.games = state.games.filter((g) => g.id !== id);
      state.assignments = state.assignments.filter((a) => a.game_id !== id);
    },
  };
}

export const api = new URLSearchParams(location.search).has("demo") ? demoApi() : supabaseApi();

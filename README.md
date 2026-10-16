# Backstage

Crew scheduling for High Five Games, at **https://backstage.highfive.games**.

- **Showtimes**: day grid like the old Google Sheet: 15-minute rows, an Unscheduled column and one column
  per crew member. Schedulers click an empty slot to add a game there.
- **Games**: upcoming, unscheduled and past games, with search.
- **My games**: your upcoming games and history.
- **Crew**: everyone's details (schedulers); approve accounts and change roles (super admin).
- **Profile**: name, phone, preferred payment method and payout email/handle. No bank details.
- **Time zones**: the clock dropdown in the top bar switches every time on the site to any time zone
  (remembered per device; defaults to the device's zone). Games are stored as exact instants, so
  everyone sees the same game at the right local time, including across daylight saving changes.

## Roles

| Role | Can |
|---|---|
| Super admin | Everything, including approving accounts and changing roles |
| Scheduler | Add/edit/delete games, assign anyone (including themselves), see crew contact info |
| Crew (employee) | See the schedule and all games, see their own history, edit their own profile |

New sign-ups are **pending** and see nothing until a super admin approves them on the Crew page.
Permissions are enforced by the database (row-level security), not just hidden in the page.

## How it's built

Static site (GitHub Pages) + Supabase for accounts and the database. No build step.

```
index.html               page shell
assets/app.js            the app (screens, schedule grid, game editor)
assets/api.js            data layer: Supabase, or an in-memory demo with ?demo
assets/config.js         Supabase URL + anon (public) key
supabase/schema.sql      tables, roles and security rules, run once in the Supabase SQL editor
supabase/test/           local tests for the security rules (stub of Supabase auth + checks)
```

Try it without signing in: open `/?demo` (sample data, nothing saved). `?demo&as=u3` shows the
employee view, `as=u2` the scheduler and `as=u5` a pending account.

## Setup (one time)

1. **Database**: Supabase → SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. **Auth settings**: Supabase → Authentication → Sign In / Providers → Email: turn **Confirm email**
   off (accounts are approved by a super admin instead). Under Authentication → URL Configuration set
   **Site URL** to `https://backstage.highfive.games`.
3. **First super admin**: sign up on the site, then in the SQL Editor run:
   `update public.profiles set role = 'super_admin', active = true where email = 'you@example.com';`
4. **Domain**: DNS CNAME `backstage` → `highfivegamesdev-cell.github.io`; repo Settings → Pages → deploy
   from `main` / root, custom domain `backstage.highfive.games`, then Enforce HTTPS.

Password reset emails use Supabase's built-in mailer, which only delivers to a few addresses and a few
emails per hour. For the whole team, add your own SMTP (Authentication → Emails → SMTP settings).

## Testing the security rules locally

```sh
cat supabase/test/supabase_stub.sql supabase/schema.sql supabase/test/policies_test.sql | psql <fresh database>
```
Ends with `ALL POLICY TESTS PASSED`.

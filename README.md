# Inboxy — logistics operations workspace

A standalone first version of the NODARA inbox workflow: capture a request, assign the next action, coordinate teams, and keep shipment context visible.

## Run

Requires Node 22+ for tests and the development server. Install the pinned dependencies and rebuild the Supabase browser bundle after changes to cloud.js.

```sh
npm ci
npm run build
npm run check
npm test
npm run dev
```

Open http://localhost:3000. Static hosting can serve the repository root. Do not open index.html with file:// because JavaScript modules require HTTP.

## Working features

- Focus control room with a priority spotlight, ranked action stream and group spaces.
- Custom groups and local people profiles: create/edit, memberships, dynamic task assignment, and rename propagation. Existing browser data migrates automatically.
- Default operational board with draggable/reorderable cards, touch drag grips, status menus and completion guards.
- Per-column Enter-to-create task entry, a compact new-task form and next-action/assignment/date quick editing.
- Board, list, and ranked Do next views; search and team/owner filters.
- Editable tasks, ownership, priorities, deadlines, follow-ups, operational instructions and cost/cutoff impact.
- Shipment records, parent/subtasks, cross-team dependencies, completion guards and activity history.
- Ops, Warehouse, Accounting and Pricing queues and workload visibility.
- Manual email capture and plain-text .eml import; multiple emails per task, email-to-task creation, saved reply drafts and mailto handoff.
- Internal notes separated from customer-facing shipment updates and opt-in milestones.
- Customer update preview, copy and downloadable HTML snapshot with internal fields excluded.
- Browser persistence, JSON backup/restore and sample reset.
- Responsive layout and keyboard-accessible task cards.

## Current boundaries

The app is connected to the **Inboxy** Supabase project (`hifqekelvzgquuputfzd`) in Ignacio’s organization. Sign up, confirm your email, sign in, and create a workspace. New workspaces start with Ops, Warehouse, Accounting, and Pricing groups and the owner’s assignment profile, with no sample operational records.

Use **Account → Workspace access** to allow a teammate’s email as a member or admin. No invitation email is sent: share the app URL separately. Teammates register and confirm their email, then sign in to join. Owners/admins manage groups, profiles and access; members can work on operational records. Assignment profile roles are labels and do not grant account permissions. All workspace members can read workspace records; groups are focused views, not security boundaries.

Data saves through atomic, revision-checked RPCs. Stale writes are rejected, with an export/reload recovery dialog. Other users’ changes are fetched every 15 seconds while idle and on window focus. Cloud records are not written to localStorage. Local demo data stays separate and can be moved explicitly using JSON export/restore. The local demo remains available from the sign-in screen.

The publishable key is safe to ship; no secret or service-role key is in the client. Row-level security protects every public table. Relational workspace memberships control access. Separate groups, people, tasks, shipments, emails, and drafts tables currently retain the app’s record shape in JSONB. Task relationships, notes and activity remain embedded; the save protocol currently serializes the workspace, so large workspaces should migrate to per-record updates before scaling.

`supabase/schema.sql` records the schema and controlled RPC definitions applied using Supabase migrations. Configure Auth’s Site URL/allowed redirects for `https://n10ai.github.io/N10-inboxy/` in the Supabase dashboard before relying on confirmation/reset redirects. The connector does not expose Auth configuration. Until configured, confirmation can redirect to Supabase’s default localhost URL; return to Inboxy and sign in after confirming. Production email delivery also needs an appropriate SMTP configuration.

Email is not connected: no OAuth, mailbox synchronization, attachment ingestion or in-app sending. Drafts save in the selected workspace; opening a mail app requires the user to review/send there. Only unencoded plain-text .eml files are supported. Exported customer updates are static snapshots, not live or revocable links. No notifications are delivered while the app is closed.

Dates in form fields use the device's local time. Prioritization is rule-based (deadline, follow-up, ownership, impact and dependent work), not AI. The Do next view includes blocked work with a visible blocked reason so it can be escalated.

See [production architecture](docs/production-plan.md) for the backend and connection work needed next.

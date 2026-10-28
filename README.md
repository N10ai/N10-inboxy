# Inboxy — logistics operations workspace

A standalone first version of the NODARA inbox workflow: capture a request, assign the next action, coordinate teams, and keep shipment context visible.

## Run

Requires Node 22+ for tests and the development server. No package installation or build step is needed.

```sh
npm run check
npm test
npm run dev
```

Open http://localhost:3000. Static hosting can serve the repository root. Do not open index.html with file:// because JavaScript modules require HTTP.

## Working features

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

This is a **local functional prototype**, preloaded with fictional sample data. It is not ready to operate as a shared production system.

Data stays in localStorage in the current browser. Team filters are not authorization, user names are demo identities, and changes do not sync across devices. Do not put sensitive operational data on a shared computer. Back up data before clearing browser storage.

Email is not connected: no OAuth, mailbox synchronization, attachment ingestion or in-app sending. Drafts stay local; opening a mail app requires the user to review/send there. Only unencoded plain-text .eml files are supported. Exported customer updates are static snapshots, not live or revocable links. No notifications are delivered while the app is closed.

Dates in form fields use the device's local time. Prioritization is rule-based (deadline, follow-up, ownership, impact and dependent work), not AI. The Do next view includes blocked work with a visible blocked reason so it can be escalated.

See [production architecture](docs/production-plan.md) for the backend and connection work needed next.

# Production implementation plan

## First decisions

Confirm Microsoft 365, Google Workspace or both; shared mailbox addresses; hosting; team membership and roles; whether customers should sign in or use expiring links. No provider credentials belong in client code or Git.

## Domain

Workspace → memberships and teams; shipment → tasks; task → parent task, dependencies, notes, activity, email references and files. A task has one accountable owner; cross-team work is represented by separately owned child tasks. Parent and dependency graphs must remain acyclic. Server transactions must enforce completion guards and valid references.

Conversations retain provider message/thread identifiers, sender, recipients, original message timestamps and attachment records. Link several messages to an operational item without duplicating tasks. Provider replies must retain the actual thread identifiers; mailto is only an interim handoff.

Customer updates are separately approved records. Internal task text must never become public implicitly. Sharing a standalone task/request needs its own approved external title/status/update, using the same publication model as shipments.

## Backend

1. Authenticated server API with a durable relational database and private object storage. Workspace-scoped authorization on every request, including uploads and downloads; explicit team visibility and admin/dispatcher/member roles.
2. Shared CRUD and audit trail, optimistic concurrency/version checks, server-enforced task graphs, notifications, and follow-up scheduling. Time stored in UTC, displayed in each user's timezone. Alerts for unanswered inbound mail and overdue promised customer updates.
3. Gmail API and/or Microsoft Graph OAuth with server-only encrypted refresh tokens and minimum required permissions. Incremental sync, webhook verification/renewal, idempotent ingestion, retry queues, attachment scanning/storage and explicit send actions. Reconcile sent mail with tasks and flag new inbound replies for review.
4. Customer portal API with high-entropy hashed share tokens, record/recipient scopes, expiration/revocation and access logs. Return only an explicit approved public schema. Never place internal records or mail in share URLs. Customer snapshots in the prototype are downloads, not tokens.
5. Automated deployment, database migrations, recovery/backups and end-to-end permission/security checks before production use.

## Acceptance scenarios for production

- A customer email creates one request; subsequent thread replies attach to it and flag attention.
- Ops assigns a warehouse subtask; only permitted users can read it and related instructions.
- Wrapping completion with evidence unblocks pickup and creates the accounting handoff.
- Follow-ups and customer update promises resurface without the browser remaining open.
- A customer tracking link exposes only approved fields; revocation blocks subsequent access.
- Parallel edits cannot silently overwrite instructions, status, or sent communication.

## Current prototype

No production backend or third-party account is provisioned. The local data model and UI provide a reviewable first iteration without implying that mailbox connections, shared permissions or live tracking already exist.

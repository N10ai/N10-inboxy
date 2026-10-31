# Email integrations

Inboxy supports Gmail/Google Workspace and Microsoft 365/Outlook through the `inboxy-mail` Supabase Edge Function. The provider credentials must be configured before connecting accounts. The UI checks server readiness and offers an in-app setup guide under Connections & data.

## Google

1. Create a Google Cloud project and enable the Gmail API.
2. Configure the OAuth consent screen. While in testing, add the intended Gmail users as test users. Google verification and its restricted-scope requirements apply before a wider production rollout.
3. Create an OAuth client of type **Web application**.
4. Register the exact redirect URI: `https://hifqekelvzgquuputfzd.supabase.co/functions/v1/inboxy-mail/callback/gmail`.
5. Add `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET` in Supabase Edge Function secrets. Do not commit credentials.
6. Connect from Inboxy and approve Gmail read/send access. Testing-mode refresh tokens may expire according to Google’s policy; reconnect when prompted.

## Microsoft

1. Register an application in Microsoft Entra, allowing the account types your organization uses.
2. Add a **Web** redirect URI (not SPA): `https://hifqekelvzgquuputfzd.supabase.co/functions/v1/inboxy-mail/callback/outlook`.
3. Configure delegated `User.Read`, `Mail.Read`, `Mail.Send`, and `offline_access`; organization policy may require admin consent.
4. Create a client secret and put its **value**, along with the application/client ID, into Supabase secrets `MICROSOFT_MAIL_CLIENT_SECRET` and `MICROSOFT_MAIL_CLIENT_ID`.
5. Connect from Inboxy. Renew the client secret before it expires.

## Operational behavior

- Connecting does not import mail automatically. The user explicitly chooses Sync inbox. The UI explains that imported bodies are shared with every workspace member.
- Sync retrieves 25 inbox messages per batch. Load older follows provider pagination. Sync inbox starts again at the latest messages. Provider IDs are hashed with connection IDs to deduplicate imports, and re-import preserves existing task links.
- Message bodies are stored as plain text. HTML is never rendered as trusted mailbox HTML. Attachments, shared-mailbox delegation, push notifications, automatic polling and sent-folder ingestion are not implemented.
- Read and send permissions are requested. Only the account that connected the mailbox can sync or send through it. Workspace admins may disconnect accounts. A disconnect deletes the encrypted stored token but retains previously imported workspace records. Users may also revoke authorization at the provider.
- Sending requires an explicit Send reply action; no automatic replies. Gmail sends reference the original thread and Message-ID; Microsoft sends through its message reply endpoint. If the response is lost, check the provider’s Sent folder before retrying.
- OAuth state has a 10-minute expiry, is single-use, and is paired with PKCE. The provider callback redirects an authorization code to the app; completion requires the same authenticated Inboxy user and workspace that started it. No access or refresh token is passed through the app URL.
- OAuth tokens are encrypted in Supabase Vault, linked through private tables. `inboxy_mail_service` is executable only by `service_role`. Client-side keys cannot retrieve them. Token cleanup also runs when connection records cascade-delete.
- `verify_jwt=false` is required for the external OAuth callback. All other actions explicitly validate the bearer token with Supabase Auth and check workspace membership and mailbox ownership.

## Deployment and validation

Apply `supabase/mail-schema.sql` once using a migration, and deploy `supabase/functions/inboxy-mail/index.ts` plus `mail-core.js`. The deployed function only requires standard Supabase server credentials plus the provider secrets above. The app return URL/CORS allowlist is fixed to the current GitHub Pages site; update both if the site moves.

`npm test` covers the UI, OAuth request shape, mailbox ownership, callback account binding, MIME parsing and reply header handling. Transactional database checks exercise one-time state, token isolation, deduplication and preserved task links, and Vault cleanup. Live provider authorization/import/send still requires real OAuth registration and a consenting test mailbox.

Official references:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
- https://supabase.com/docs/guides/database/vault

Security advisor note: the project's Auth configuration currently reports leaked-password protection disabled. This is independent of mailbox RLS; configuration details: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

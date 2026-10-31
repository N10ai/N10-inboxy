-- Mailbox metadata is shared; provider credentials are encrypted in Vault.
create table public.mail_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces on delete cascade,
 user_id uuid not null references auth.users on delete cascade,
 provider text not null check(provider in ('gmail','outlook')),
 email text not null, last_sync timestamptz, created_at timestamptz not null default now(),
 unique(workspace_id,user_id,provider,email)
);
create index mail_connections_user_idx on public.mail_connections(user_id);
alter table public.mail_connections enable row level security;
revoke all on public.mail_connections from anon,authenticated;
grant select on public.mail_connections to authenticated;
create policy mailbox_member_read on public.mail_connections for select to authenticated using(inboxy_private.is_member(workspace_id));
create table inboxy_private.mail_tokens(connection_id uuid primary key references public.mail_connections on delete cascade,secret_id uuid not null references vault.secrets);
create table inboxy_private.mail_oauth_states(state_hash text primary key, workspace_id uuid not null references public.workspaces on delete cascade,user_id uuid not null references auth.users on delete cascade,provider text not null check(provider in ('gmail','outlook')),verifier text not null,expires_at timestamptz not null default now()+interval '10 minutes');
alter table inboxy_private.mail_tokens enable row level security;
alter table inboxy_private.mail_oauth_states enable row level security;
revoke all on inboxy_private.mail_tokens,inboxy_private.mail_oauth_states from public,anon,authenticated;
create function inboxy_private.mail_service(op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s inboxy_private.mail_oauth_states; c public.mail_connections; sid uuid; tokens jsonb; msg jsonb; total int:=0; w uuid;begin
case op
when 'state_create' then
 delete from inboxy_private.mail_oauth_states where expires_at<now();
 insert into inboxy_private.mail_oauth_states(state_hash,workspace_id,user_id,provider,verifier) values(p->>'hash',(p->>'workspace')::uuid,(p->>'user')::uuid,p->>'provider',p->>'verifier');return '{}'::jsonb;
when 'state_take' then
 delete from inboxy_private.mail_oauth_states where state_hash=p->>'hash' and expires_at>now() returning * into s;
 if s.state_hash is null then raise exception 'Invalid or expired connection request';end if;return to_jsonb(s);
when 'connect' then
 if not exists(select 1 from public.workspace_members where workspace_id=(p->>'workspace')::uuid and user_id=(p->>'user')::uuid) then raise exception 'Workspace access denied';end if;
 insert into public.mail_connections(workspace_id,user_id,provider,email) values((p->>'workspace')::uuid,(p->>'user')::uuid,p->>'provider',lower(p->>'email')) on conflict(workspace_id,user_id,provider,email) do update set email=excluded.email returning * into c;
 select secret_id into sid from inboxy_private.mail_tokens where connection_id=c.id;
 if sid is null then select vault.create_secret((p->'tokens')::text) into sid;insert into inboxy_private.mail_tokens values(c.id,sid);
 else perform vault.update_secret(sid,(p->'tokens')::text);end if;return to_jsonb(c);
when 'tokens' then
 select v.decrypted_secret::jsonb into tokens from vault.decrypted_secrets v join inboxy_private.mail_tokens m on m.secret_id=v.id where m.connection_id=(p->>'connection')::uuid;
 if tokens is null then raise exception 'Mailbox is disconnected';end if;return tokens;
when 'tokens_update' then
 select secret_id into sid from inboxy_private.mail_tokens where connection_id=(p->>'connection')::uuid;
 if sid is null then raise exception 'Mailbox is disconnected';end if;
 perform vault.update_secret(sid,(p->'tokens')::text);return '{}'::jsonb;
when 'disconnect' then
 select secret_id into sid from inboxy_private.mail_tokens where connection_id=(p->>'connection')::uuid;
 delete from inboxy_private.mail_tokens where connection_id=(p->>'connection')::uuid;
 delete from public.mail_connections where id=(p->>'connection')::uuid;
 if sid is not null then delete from vault.secrets where id=sid;end if;return '{}'::jsonb;
when 'ingest' then
 select * into c from public.mail_connections where id=(p->>'connection')::uuid;
 if c.id is null then raise exception 'Mailbox is disconnected';end if;
 w:=c.workspace_id;perform 1 from public.workspaces where id=w for update;
 for msg in select value from jsonb_array_elements(p->'messages') loop
 if msg->>'connectionId'<>c.id::text then raise exception 'Mailbox mismatch';end if;
 insert into public.emails(workspace_id,id,data) values(w,msg->>'id',msg)
 on conflict(workspace_id,id) do update set data=public.emails.data||excluded.data||jsonb_build_object('taskId',public.emails.data->'taskId');total:=total+1;
 end loop;
 update public.mail_connections set last_sync=now() where id=c.id;
 if total>0 then update public.workspaces set revision=revision+1 where id=w;end if;
 return jsonb_build_object('processed',total);
else raise exception 'Unknown mailbox operation';end case;end$$;
create function public.inboxy_mail_service(op text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$select inboxy_private.mail_service(op,p)$$;
revoke all on function inboxy_private.mail_service(text,jsonb),public.inboxy_mail_service(text,jsonb) from public,anon,authenticated;
grant usage on schema inboxy_private to service_role;
grant execute on function inboxy_private.mail_service(text,jsonb),public.inboxy_mail_service(text,jsonb) to service_role;

create policy no_client_access on inboxy_private.mail_tokens for all to anon,authenticated using(false) with check(false);
create policy no_client_access on inboxy_private.mail_oauth_states for all to anon,authenticated using(false) with check(false);
create function inboxy_private.cleanup_mail_secret() returns trigger language plpgsql security definer set search_path='' as $$begin delete from vault.secrets where id=old.secret_id;return old;end$$;
revoke all on function inboxy_private.cleanup_mail_secret() from public,anon,authenticated;
create trigger cleanup_mail_secret after delete on inboxy_private.mail_tokens for each row execute function inboxy_private.cleanup_mail_secret();

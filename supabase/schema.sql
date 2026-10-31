-- Inboxy backend v1. JSONB records preserve the existing app contract;
-- workspace identity, access and revision control are relational.
create schema if not exists inboxy_private;
revoke all on schema inboxy_private from public;
grant usage on schema inboxy_private to authenticated;
create table public.profiles (id uuid primary key references auth.users on delete cascade, display_name text not null, created_at timestamptz not null default now());
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), revision bigint not null default 0, created_at timestamptz not null default now());
create table public.workspace_members (workspace_id uuid references public.workspaces on delete cascade, user_id uuid references auth.users on delete cascade, role text not null check(role in ('owner','admin','member')), primary key(workspace_id,user_id));
create index workspace_members_user_idx on public.workspace_members(user_id);
create table public.workspace_access (workspace_id uuid references public.workspaces on delete cascade, email text not null check(email=lower(email)), role text not null check(role in ('admin','member')), created_at timestamptz not null default now(), primary key(workspace_id,email));
create function inboxy_private.is_member(w uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid())$$;
create function inboxy_private.is_admin(w uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid() and role in ('owner','admin'))$$;
do $$declare t text;begin foreach t in array array['groups','people','shipments','tasks','emails','drafts'] loop
 execute format('create table public.%I (workspace_id uuid not null references public.workspaces on delete cascade, id text not null, data jsonb not null check(jsonb_typeof(data)=''object'' and data->>''id''=id), primary key(workspace_id,id))',t);
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy member_read on public.%I for select to authenticated using (inboxy_private.is_member(workspace_id))',t);
 execute format('grant select on public.%I to authenticated',t);
end loop;end$$;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_access enable row level security;
create policy own_profile on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy workspace_read on public.workspaces for select to authenticated using(inboxy_private.is_member(id));
create policy members_read on public.workspace_members for select to authenticated using(inboxy_private.is_member(workspace_id));
create policy access_read on public.workspace_access for select to authenticated using(inboxy_private.is_admin(workspace_id));
revoke all on public.profiles,public.workspaces,public.workspace_members,public.workspace_access,public.groups,public.people,public.shipments,public.tasks,public.emails,public.drafts from anon,authenticated;
grant select on public.profiles,public.workspaces,public.workspace_members,public.workspace_access,public.groups,public.people,public.shipments,public.tasks,public.emails,public.drafts to authenticated;
-- Only controlled RPCs can mutate data; no direct table writes.
create function inboxy_private.bootstrap() returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();begin
 if u is null then raise exception 'Sign in required';end if;
 insert into public.profiles(id,display_name) select u,coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(email,'@',1)) from auth.users where id=u on conflict do nothing;
 insert into public.workspace_members(workspace_id,user_id,role) select a.workspace_id,u,a.role from public.workspace_access a join auth.users us on us.id=u and lower(us.email)=a.email where us.email_confirmed_at is not null on conflict do nothing;
end$$;
create function public.inboxy_bootstrap() returns void language sql security invoker set search_path='' as $$select inboxy_private.bootstrap()$$;
create function inboxy_private.create_workspace(n text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin if auth.uid() is null then raise exception 'Sign in required';end if;
insert into public.workspaces(name) values(trim(n)) returning id into w;
insert into public.workspace_members values(w,auth.uid(),'owner');return w;end$$;
create function public.inboxy_create_workspace(n text) returns uuid language sql security invoker set search_path='' as $$select inboxy_private.create_workspace(n)$$;
create function public.inboxy_load(w uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; t text; a jsonb;begin
 if not inboxy_private.is_member(w) then raise exception 'Workspace access denied';end if;
 select jsonb_build_object('version',1,'revision',revision) into result from public.workspaces where id=w;
 foreach t in array array['groups','people','shipments','tasks','emails','drafts'] loop
 execute format('select coalesce(jsonb_agg(data order by id),''[]''::jsonb) from public.%I where workspace_id=$1',t) into a using w;result:=result||jsonb_build_object(t,a);end loop;return result;end$$;
create function inboxy_private.save_workspace(w uuid, expected_revision bigint, snapshot jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare rev bigint;t text;begin
 if not inboxy_private.is_member(w) then raise exception 'Workspace access denied';end if;
 select revision into rev from public.workspaces where id=w for update;
 if rev<>expected_revision then raise exception 'CONFLICT: Workspace changed. Export your unsaved work, then reload.';end if;
 foreach t in array array['groups','people','shipments','tasks','emails','drafts'] loop
 if jsonb_typeof(snapshot->t) is distinct from 'array' then raise exception 'Invalid collection %',t;end if;
 if t in ('groups','people') and not inboxy_private.is_admin(w) and exists(select 1 from (select data from public.groups where workspace_id=w and t='groups' union all select data from public.people where workspace_id=w and t='people') d full join jsonb_array_elements(snapshot->t) x on d.data=x where d.data is null or x is null) then raise exception 'Only admins can change the directory';end if;
 execute format('delete from public.%I where workspace_id=$1 and id not in (select value->>''id'' from jsonb_array_elements($2))',t) using w,snapshot->t;
 execute format('insert into public.%I(workspace_id,id,data) select $1,value->>''id'',value from jsonb_array_elements($2) on conflict(workspace_id,id) do update set data=excluded.data',t) using w,snapshot->t;
 end loop;
 update public.workspaces set revision=revision+1 where id=w returning revision into rev;return rev;end$$;
create function public.inboxy_save(w uuid,expected_revision bigint,snapshot jsonb) returns bigint language sql security invoker set search_path='' as $$select inboxy_private.save_workspace(w,expected_revision,snapshot)$$;
create function inboxy_private.grant_access(w uuid,e text,r text) returns void language plpgsql security definer set search_path='' as $$begin
if not inboxy_private.is_admin(w) then raise exception 'Admin access required';end if;
if e is null or position('@' in e)<2 then raise exception 'Valid email required';end if;
insert into public.workspace_access(workspace_id,email,role) values(w,lower(trim(e)),r) on conflict(workspace_id,email) do update set role=excluded.role;
end$$;
create function public.inboxy_grant_access(w uuid,e text,r text) returns void language sql security invoker set search_path='' as $$select inboxy_private.grant_access(w,e,r)$$;
create function inboxy_private.revoke_access(w uuid,e text) returns void language plpgsql security definer set search_path='' as $$begin
if not inboxy_private.is_admin(w) then raise exception 'Admin access required';end if;
delete from public.workspace_access where workspace_id=w and email=lower(trim(e));
delete from public.workspace_members m using auth.users u where m.workspace_id=w and m.user_id=u.id and lower(u.email)=lower(trim(e)) and m.role<>'owner';end$$;
create function public.inboxy_revoke_access(w uuid,e text) returns void language sql security invoker set search_path='' as $$select inboxy_private.revoke_access(w,e)$$;
revoke all on all functions in schema inboxy_private from public,anon;
grant execute on all functions in schema inboxy_private to authenticated;
revoke all on function public.inboxy_bootstrap(),public.inboxy_create_workspace(text),public.inboxy_load(uuid),public.inboxy_save(uuid,bigint,jsonb),public.inboxy_grant_access(uuid,text,text),public.inboxy_revoke_access(uuid,text) from public,anon;
grant execute on function public.inboxy_bootstrap(),public.inboxy_create_workspace(text),public.inboxy_load(uuid),public.inboxy_save(uuid,bigint,jsonb),public.inboxy_grant_access(uuid,text,text),public.inboxy_revoke_access(uuid,text) to authenticated;

-- Initialize real workspaces without copying demo operational records.
create or replace function inboxy_private.create_workspace(n text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; team_name text;begin if auth.uid() is null then raise exception 'Sign in required';end if;
insert into public.workspaces(name) values(trim(n)) returning id into w;
insert into public.workspace_members values(w,auth.uid(),'owner');
foreach team_name in array array['Ops','Warehouse','Accounting','Pricing'] loop
insert into public.groups(workspace_id,id,data) values(w,lower(team_name),jsonb_build_object('id',lower(team_name),'name',team_name,'description','','members','[]'::jsonb));end loop;
insert into public.people(workspace_id,id,data) select w,u.id::text,jsonb_build_object('id',u.id::text,'name',coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),'email',u.email,'role','Admin') from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid();
return w;end$$;
create or replace function inboxy_private.grant_access(w uuid,e text,r text) returns void language plpgsql security definer set search_path='' as $$begin
if not inboxy_private.is_admin(w) then raise exception 'Admin access required';end if;
if e is null or position('@' in e)<2 then raise exception 'Valid email required';end if;
insert into public.workspace_access(workspace_id,email,role) values(w,lower(trim(e)),r) on conflict(workspace_id,email) do update set role=excluded.role;
update public.workspace_members m set role=r from auth.users u where m.workspace_id=w and m.user_id=u.id and lower(u.email)=lower(trim(e)) and m.role<>'owner';end$$;

-- Verified teammates become assignment profiles when they join.
create or replace function inboxy_private.bootstrap() returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();begin
if u is null then raise exception 'Sign in required';end if;
insert into public.profiles(id,display_name) select u,coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(email,'@',1)) from auth.users where id=u on conflict do nothing;
insert into public.workspace_members(workspace_id,user_id,role) select a.workspace_id,u,a.role from public.workspace_access a join auth.users us on us.id=u and lower(us.email)=a.email where us.email_confirmed_at is not null on conflict do nothing;
with added as (
insert into public.people(workspace_id,id,data) select m.workspace_id,u::text,jsonb_build_object('id',u::text,'name',p.display_name,'email',us.email,'role',case when m.role in ('owner','admin') then 'Admin' else 'Member' end) from public.workspace_members m join public.profiles p on p.id=u join auth.users us on us.id=u where m.user_id=u on conflict do nothing returning workspace_id
) update public.workspaces set revision=revision+1 where id in (select workspace_id from added);
end$$;

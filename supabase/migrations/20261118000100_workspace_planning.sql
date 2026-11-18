-- Planning shares the existing workspace RLS and revision-checked save transaction.
alter table public.workspaces add column planning jsonb not null default '{}'::jsonb;

create or replace function public.inboxy_load(w uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; t text; a jsonb;begin
 if not inboxy_private.is_member(w) then raise exception 'Workspace access denied';end if;
 select jsonb_build_object('version',1,'revision',revision)||planning into result from public.workspaces where id=w;
 foreach t in array array['groups','people','shipments','tasks','emails','drafts'] loop
 execute format('select coalesce(jsonb_agg(data order by id),''[]''::jsonb) from public.%I where workspace_id=$1',t) into a using w;result:=result||jsonb_build_object(t,a);end loop;return result;end$$;
create or replace function inboxy_private.save_workspace(w uuid, expected_revision bigint, snapshot jsonb) returns bigint language plpgsql security definer set search_path='' as $$
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
 if snapshot ? 'clients' and (jsonb_typeof(snapshot->'clients') is distinct from 'array' or exists (
  select 1 from jsonb_array_elements(snapshot->'clients') item
  where coalesce(item->>'id','') !~ '^[a-zA-Z0-9-]+$' or coalesce(trim(item->>'name'),'')=''
 )) then raise exception 'Invalid clients';end if;
 if snapshot ? 'taskTypes' and jsonb_typeof(snapshot->'taskTypes') is distinct from 'array' then raise exception 'Invalid task types';end if;
 update public.workspaces set revision=revision+1, planning=planning
  || case when snapshot ? 'clients' then jsonb_build_object('clients',snapshot->'clients') else '{}'::jsonb end
  || case when snapshot ? 'taskTypes' then jsonb_build_object('taskTypes',snapshot->'taskTypes') else '{}'::jsonb end
 where id=w returning revision into rev;return rev;end$$;

import {createClient} from '@supabase/supabase-js';
export const client=createClient('https://hifqekelvzgquuputfzd.supabase.co','sb_publishable_P09r2oiIOmFecodZhIHH7A_q0V3Yc8K');
export const cloud={workspace:null,user:null,revision:0,pending:false,failed:false,role:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function rpc(name,args){const {data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data;}
export async function startCloud(onLoad,onDemo){
 const root=document.querySelector('#app');
 const {data:{session}}=await client.auth.getSession();
 if(!session)return authScreen();
 cloud.user=session.user;
 try{
 await rpc('inboxy_bootstrap');
 const {data,error}=await client.from('workspaces').select('*').order('created_at');if(error)throw error;
 if(!data.length)return chooseWorkspace([]);
 const selected=data.find(w=>w.id===localStorage.getItem('inboxy.selectedWorkspace'));
 if(selected)return enter(selected);
 return chooseWorkspace(data);
 }catch(e){authScreen(e.message);}
 async function enter(w){
 try{cloud.workspace=w;localStorage.setItem('inboxy.selectedWorkspace',w.id);
 const {data,error}=await client.from('workspace_members').select('role').eq('workspace_id',w.id).eq('user_id',cloud.user.id).single();if(error)throw error;cloud.role=data.role;
 const snapshot=await rpc('inboxy_load',{w:w.id});cloud.revision=snapshot.revision;onLoad(snapshot);
 }catch(e){cloud.workspace=null;authScreen(e.message);}}
 function chooseWorkspace(workspaces){
 root.innerHTML=`<main class="auth-shell"><section class="auth-card"><span class="eyebrow">INBOXY / CONNECTED WORK</span><h1>Your workspaces.</h1><p>Open your team’s space or create one. If your admin just granted access, refresh to join.</p>${workspaces.map(w=>`<button class="workspace-choice" data-workspace="${w.id}">${esc(w.name)} →</button>`).join('')}<form id="create-workspace"><label class="field">New workspace name<input name="name" required maxlength="100" placeholder="e.g. MIP Operations"></label><button class="primary">Create workspace</button></form><p id="auth-message" role="status"></p><button id="signout">Sign out</button></section></main>`;
 root.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>enter(workspaces.find(w=>w.id===b.dataset.workspace)));
 root.querySelector('#signout').onclick=()=>logout();
 root.querySelector('#create-workspace').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const name=new FormData(e.target).get('name').trim();const id=await rpc('inboxy_create_workspace',{n:name});await enter({id,name});}catch(err){root.querySelector('#auth-message').textContent=err.message;b.disabled=false;}};
 }
 function authScreen(message=''){
 root.innerHTML=`<main class="auth-shell"><section class="auth-card"><span class="eyebrow">INBOXY / OPERATIONS, CONNECTED</span><h1>Every handoff.<br>One workspace.</h1><p>Sign in to keep your team’s requests, shipments, and next actions together.</p><form id="auth-form"><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8"></label><label class="field">Your name <small>For new accounts</small><input name="name" autocomplete="name" maxlength="80"></label><div class="actions"><button class="primary" name="mode" value="signin">Sign in</button><button name="mode" value="signup">Create account</button></div></form><p id="auth-message" role="status">${esc(message)}</p><button id="demo-mode">Explore the local demo →</button></section></main>`;
 root.querySelector('#demo-mode').onclick=onDemo;
 root.querySelector('#auth-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),mode=e.submitter.value;root.querySelectorAll('button').forEach(b=>b.disabled=true);try{
 const credentials={email:f.get('email'),password:f.get('password')};
 const {data,error}=mode==='signup'?await client.auth.signUp({...credentials,options:{data:{display_name:f.get('name')}}}):await client.auth.signInWithPassword(credentials);if(error)throw error;
 if(data.session)location.reload();else root.querySelector('#auth-message').textContent='Check your email to confirm your account. Then return here and sign in.';
 }catch(err){root.querySelector('#auth-message').textContent=err.message;}finally{root.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 }
}
export async function logout(){if(cloud.pending||cloud.failed){alert('Your changes are not saved. Download a backup or finish saving before signing out.');return;}const {error}=await client.auth.signOut();if(error){alert(error.message);return;}location.reload();}
let queued=null,running=false;
export function saveCloud(snapshot,onError){
 if(cloud.failed){onError(Error('Cloud save is paused. Download your work and reload before editing further.'));return;}
 queued=structuredClone(snapshot);cloud.pending=true;paintStatus('Saving…');if(running)return;
 running=true;
 (async()=>{try{while(queued){const next=queued;queued=null;cloud.revision=await rpc('inboxy_save',{w:cloud.workspace.id,expected_revision:cloud.revision,snapshot:next});}cloud.pending=false;paintStatus('Saved to Supabase');}catch(e){queued=null;cloud.failed=true;cloud.pending=false;paintStatus('Not saved · export before reload');onError(e);}finally{running=false;}})();
}
function paintStatus(s){document.querySelector('[data-cloud-status]')?.replaceChildren(document.createTextNode(s));}
export async function refreshCloud(onLoad){if(!cloud.workspace||cloud.pending||cloud.failed||document.querySelector('#detail').open||document.activeElement?.matches('input,textarea,select'))return;try{const s=await rpc('inboxy_load',{w:cloud.workspace.id});if(!cloud.pending&&!cloud.failed&&s.revision>cloud.revision){cloud.revision=s.revision;onLoad(s);}}catch{paintStatus('Connection unavailable');}}
export async function accessPanel(container){
 const {data,error}=await client.from('workspace_access').select('email,role').eq('workspace_id',cloud.workspace.id);if(error)throw error;
 container.innerHTML=`<h2>Workspace access</h2><p>Allow a teammate’s email, then share the app URL. They create their own account and confirm their email. This does not send an invitation email.</p><form id="access-form" class="form-grid"><label class="field">Email<input name="email" type="email" required></label><label class="field">Access role<select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label><button class="primary">Allow access</button></form><p>Owners and admins manage groups, profiles and access. Members work on operations. All members can see this workspace; group queues filter work.</p>${data.map(a=>`<p>${esc(a.email)} · ${esc(a.role)} <button data-revoke="${esc(a.email)}">Remove access</button></p>`).join('')}<p id="access-feedback" role="status"></p>`;
 container.querySelector('#access-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await rpc('inboxy_grant_access',{w:cloud.workspace.id,e:f.get('email'),r:f.get('role')});await accessPanel(container);}catch(err){container.querySelector('#access-feedback').textContent=err.message;}};
 container.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{try{await rpc('inboxy_revoke_access',{w:cloud.workspace.id,e:b.dataset.revoke});await accessPanel(container);}catch(err){container.querySelector('#access-feedback').textContent=err.message;}});
}
window.addEventListener('beforeunload',e=>{if(cloud.pending||cloud.failed){e.preventDefault();e.returnValue='';}});

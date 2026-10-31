import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {APP_URL,PROVIDERS,base64url,hash,challenge,authorizationURL,gmailRecord,outlookRecord,gmailReply,safeAddress} from './mail-core.js';
const env=n=>Deno.env.get(n)||'';
const service=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const endpoint=env('SUPABASE_URL')+'/functions/v1/inboxy-mail';
const cors={'Access-Control-Allow-Origin':new URL(APP_URL).origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function checked(result){if(result.error)throw Error(result.error.message);return result.data;}
async function db(op,p){return checked(await service.rpc('inboxy_mail_service',{op,p}));}
function configured(p){return !!(env(PROVIDERS[p].idEnv)&&env(PROVIDERS[p].secretEnv));}
async function member(workspace,user){const m=await checked(await service.from('workspace_members').select('role').eq('workspace_id',workspace).eq('user_id',user).maybeSingle());if(!m)throw Error('Workspace access denied');return m.role;}
async function tokenCall(provider,params){const p=PROVIDERS[provider];if(!configured(provider))throw Error('Provider setup required');const r=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env(p.idEnv),client_secret:env(p.secretEnv),...params})});if(!r.ok)throw Error('Provider authorization failed. Reconnect this mailbox.');const t=await r.json();if(!t.access_token)throw Error('Provider returned no access token');return {...t,expires_at:Date.now()+Number(t.expires_in||3600)*1000};}
async function accessToken(c){const t=await db('tokens',{connection:c.id});if(t.expires_at>Date.now()+60000)return t.access_token;if(!t.refresh_token)throw Error('Reconnect this mailbox to renew access');const updated=await tokenCall(c.provider,{grant_type:'refresh_token',refresh_token:t.refresh_token});const next={...t,...updated,refresh_token:updated.refresh_token||t.refresh_token};await db('tokens_update',{connection:c.id,tokens:next});return next.access_token;}
async function providerFetch(url,token,options={}){const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});if(!r.ok)throw Error(r.status===429?'Mailbox provider rate limit reached. Try again later.':'Mailbox provider request failed ('+r.status+'). Reconnect if access was revoked.');return r.status===204||r.status===202?null:r.json();}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const url=new URL(req.url),callback=url.pathname.includes('/callback/');
 try{
 if(callback){
 if(req.method!=='GET')return json({error:'Method not allowed'},405);
 if(url.searchParams.has('error'))return Response.redirect(APP_URL+'?mail=cancelled',303);
 const code=url.searchParams.get('code'),state=url.searchParams.get('state'),provider=url.pathname.split('/').pop();
 if(!code||!state||!PROVIDERS[provider])throw Error('Invalid provider callback');
 // Finish in the app under its current authenticated user. Possessing an
 // OAuth URL alone must never let someone link a victim's mailbox.
 return Response.redirect(APP_URL+'?'+new URLSearchParams({mail:'complete',mail_code:code,mail_state:state,mail_provider:provider}),303);
 }
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(APP_URL).origin)return json({error:'Origin not allowed'},403);
 const bearer=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!bearer)return json({error:'Sign in required'},401);
 const {data:{user},error}=await service.auth.getUser(bearer);if(error||!user)return json({error:'Sign in required'},401);
 const input=await req.json(),role=await member(input.workspace,user.id);
 if(input.action==='complete'){
 const state=await db('state_take',{hash:await hash(String(input.state||''))});
 if(state.user_id!==user.id||state.workspace_id!==input.workspace||state.provider!==input.provider)throw Error('Sign in with the account that started this mailbox connection, then reconnect.');
 const provider=state.provider;
 const tokens=await tokenCall(provider,{grant_type:'authorization_code',code:String(input.code||''),code_verifier:state.verifier,redirect_uri:endpoint+'/callback/'+provider});
 if(!tokens.refresh_token)throw Error('Offline access was not granted. Reconnect and approve access.');
 const profile=provider==='gmail'?await providerFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',tokens.access_token):await providerFetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',tokens.access_token);
 const email=provider==='gmail'?profile.emailAddress:profile.mail||profile.userPrincipalName;
 if(!email)throw Error('Mailbox address unavailable');
 await db('connect',{workspace:state.workspace_id,user:state.user_id,provider,email,tokens});return json({connected:true});
 }
 if(input.action==='status'){
 const connections=await checked(await service.from('mail_connections').select('*').eq('workspace_id',input.workspace).order('created_at'));
 return json({providers:Object.fromEntries(Object.entries(PROVIDERS).map(([key,p])=>[key,{label:p.label,configured:configured(key),callback:endpoint+'/callback/'+key,clientIdSecret:p.idEnv,clientSecretSecret:p.secretEnv}])),connections});
 }
 if(input.action==='start'){
 const provider=input.provider;if(!PROVIDERS[provider])throw Error('Unsupported provider');if(!configured(provider))return json({error:'Provider setup required. Add the OAuth app credentials in Supabase Edge Function secrets.'},409);
 const state=base64url(crypto.getRandomValues(new Uint8Array(32))),verifier=base64url(crypto.getRandomValues(new Uint8Array(48)));
 await db('state_create',{hash:await hash(state),verifier,workspace:input.workspace,user:user.id,provider});
 return json({url:authorizationURL(provider,env(PROVIDERS[provider].idEnv),endpoint+'/callback/'+provider,state,await challenge(verifier))});
 }
 const c=await checked(await service.from('mail_connections').select('*').eq('workspace_id',input.workspace).eq('id',input.connection).maybeSingle());
 if(!c)throw Error('Mailbox not found');
 if(input.action==='disconnect'){
 if(c.user_id!==user.id&&!['owner','admin'].includes(role))throw Error('Only the mailbox owner or a workspace admin can disconnect it');
 await db('disconnect',{connection:c.id});return json({disconnected:true});
 }
 if(c.user_id!==user.id)throw Error('Only the connected mailbox owner can sync or send');
 const token=await accessToken(c);
 if(input.action==='sync'){
 let messages=[],nextCursor=null;const max=25;const cursor=typeof input.cursor==='string'&&input.cursor.length<10000?input.cursor:null;
 if(c.provider==='gmail'){
 const list=await providerFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+new URLSearchParams({maxResults:String(max),q:'in:inbox',...(cursor?{pageToken:cursor}:{})}),token);
 nextCursor=list.nextPageToken||null;for(const item of list.messages||[]){const m=await providerFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(item.id)+'?format=full',token);messages.push(gmailRecord(m,c.id,'mail-'+await hash(c.id+':'+m.id)));}
 }else{
 let listURL='https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?'+new URLSearchParams({'$top':String(max),'$orderby':'receivedDateTime desc','$select':'id,subject,from,replyTo,body,bodyPreview,receivedDateTime,conversationId,internetMessageId'});if(cursor){const u=new URL(cursor);if(u.origin!=='https://graph.microsoft.com'||u.pathname!=='/v1.0/me/mailFolders/inbox/messages')throw Error('Invalid mailbox cursor');listURL=u.href;}const list=await providerFetch(listURL,token,{headers:{Prefer:'outlook.body-content-type="text", IdType="ImmutableId"'}});
 nextCursor=list['@odata.nextLink']||null;for(const m of list.value||[])messages.push(outlookRecord(m,c.id,'mail-'+await hash(c.id+':'+m.id)));
 }
 const result=await db('ingest',{connection:c.id,messages});return json({...result,limit:max,nextCursor,scope:'Inbox messages are imported in batches of 25. Use Load older for earlier messages.'});
 }
 if(input.action==='reply'){
 const original=await checked(await service.from('emails').select('data').eq('workspace_id',c.workspace_id).eq('id',input.email).maybeSingle());
 if(!original||original.data.connectionId!==c.id)throw Error('Original message not found in this mailbox');
 const body=String(input.body||'').trim();if(!body||body.length>50000)throw Error('Reply must contain 1–50,000 characters');
 const to=safeAddress(input.to),subject=String(input.subject||'Re: '+original.data.subject).slice(0,400);
 if(c.provider==='gmail')await providerFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:original.data.threadId,raw:gmailReply(original.data,to,subject,body)})});
 else await providerFetch('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(original.data.providerMessageId)+'/reply',token,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'IdType="ImmutableId"'},body:JSON.stringify({message:{subject,toRecipients:[{emailAddress:{address:to}}]},comment:body})});
 return json({sent:true});
 }
 return json({error:'Unknown action'},400);
 }catch(e){if(callback)return Response.redirect(APP_URL+'?mail=failed',303);return json({error:e.message||'Mailbox request failed'},400);}
});

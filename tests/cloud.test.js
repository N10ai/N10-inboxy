import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['app.js'],bundle:true,format:'iife',write:false});
const source=bundle.outputFiles[0].text;
async function app(session=false){
 const dom=new JSDOM('<div id="app"></div><dialog id="detail"></dialog><div id="toast"></div>',{url:'https://n10ai.github.io/N10-inboxy/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.structuredClone=structuredClone;w.Response=Response;w.Headers=Headers;w.Request=Request;w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const requests=[];let revision=0;
 const snapshot={version:1,revision:0,groups:[{id:'ops',name:'Ops',description:'',members:[]}],people:[],tasks:[],shipments:[],emails:[],drafts:[]};
 if(session){w.localStorage.setItem('sb-hifqekelvzgquuputfzd-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'10000000-0000-4000-8000-000000000001',email:'operator@example.invalid'}}));w.localStorage.setItem('inboxy.selectedWorkspace','20000000-0000-4000-8000-000000000001');}
 w.fetch=async(url,opts={})=>{requests.push({url:String(url),body:opts.body});let data=null;const path=new URL(url).pathname;
 if(path.endsWith('/inboxy-mail'))data={providers:{gmail:{label:'Gmail',configured:false,callback:'https://callback.invalid',clientIdSecret:'GOOGLE_MAIL_CLIENT_ID',clientSecretSecret:'GOOGLE_MAIL_CLIENT_SECRET'}},connections:[]};
 else if(path.endsWith('/workspaces'))data=[{id:'20000000-0000-4000-8000-000000000001',name:'Test Operations',revision}];
 else if(path.endsWith('/workspace_members'))data={role:'owner'};
 else if(path.endsWith('/inboxy_load'))data={...snapshot,revision};
 else if(path.endsWith('/inboxy_save')){const body=JSON.parse(opts.body);assert.equal(body.expected_revision,revision);Object.assign(snapshot,body.snapshot);data=++revision;}
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
 w.eval(source);await new Promise(r=>setTimeout(r,100));return {dom,w,requests,snapshot};
}
test('signed-out users see auth and can explore the local demo',async()=>{const {dom,w}=await app();try{assert.match(w.document.querySelector('h1').textContent,/Every handoff/);assert.ok(w.document.querySelector('#auth-form'));w.document.querySelector('#demo-mode').click();assert.equal(w.document.querySelector('h1').textContent,'Operations inbox');assert.equal(w.document.querySelector('#account-access').textContent,'Sign in');}finally{dom.window.close();}});
test('signed-in workspace loads without sample tasks and saves a quick task',async()=>{const {dom,w,requests,snapshot}=await app(true);try{assert.equal(w.document.querySelector('h1').textContent,'Operations inbox');assert.match(w.document.querySelector('.workspace').textContent,/Test Operations/);assert.equal(snapshot.tasks.length,0);w.document.querySelector('#new-task').click();const form=w.document.querySelector('#quick-task-form');form.elements.title.value='Wrap pallet 3';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100));assert.equal(snapshot.tasks[0].title,'Wrap pallet 3');assert.ok(requests.some(r=>r.url.endsWith('/rpc/inboxy_save')));assert.equal(w.localStorage.getItem('inboxy.workspace.v1'),null);}finally{dom.window.close();}});

test('group editor customizes color and icon, and empty-group deletion works in the UI',async()=>{const {dom,w}=await app();try{w.document.querySelector('#demo-mode').click();w.document.querySelector('[data-page="groups"]').click();w.document.querySelector('#new-group').click();const form=w.document.querySelector('#group-form');form.elements.name.value='Dispatch';form.elements.color.value='#225588';form.elements.icon.value='◈';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const saved=JSON.parse(w.localStorage.getItem('inboxy.workspace.v1'));const group=saved.groups.find(g=>g.name==='Dispatch');assert.equal(group.color,'#225588');assert.equal(group.icon,'◈');w.document.querySelector(`[data-edit-group="${group.id}"]`).click();w.document.querySelector('#delete-group').click();w.document.querySelector('#delete-group-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(JSON.parse(w.localStorage.getItem('inboxy.workspace.v1')).groups.some(g=>g.id===group.id),false);}finally{dom.window.close();}});
test('email connections show missing setup and an actionable setup guide',async()=>{const {dom,w}=await app(true);try{w.document.querySelector('[data-page="settings"]').click();await new Promise(r=>setTimeout(r,100));assert.match(w.document.querySelector('#mail-integrations').textContent,/Provider setup needed/);assert.equal(w.document.querySelector('[data-mail-connect]').disabled,true);w.document.querySelector('[data-mail-setup]').click();assert.match(w.document.querySelector('#detail').textContent,/GOOGLE_MAIL_CLIENT_SECRET/);}finally{dom.window.close();}});

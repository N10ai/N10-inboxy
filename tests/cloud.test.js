import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['app.js'],bundle:true,format:'iife',write:false});
const source=bundle.outputFiles[0].text;
async function app(session=false,fixture={}){
 const dom=new JSDOM('<div id="app"></div><dialog id="detail"></dialog><div id="toast"></div>',{url:'https://n10ai.github.io/N10-inboxy/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.structuredClone=structuredClone;w.Response=Response;w.Headers=Headers;w.Request=Request;w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const requests=[];let revision=0;
 const snapshot={version:1,revision:0,groups:[{id:'ops',name:'Ops',description:'',members:[]}],people:[],tasks:[],shipments:[],emails:[],drafts:[],...fixture};
 if(session){w.localStorage.setItem('sb-hifqekelvzgquuputfzd-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'10000000-0000-4000-8000-000000000001',email:'operator@example.invalid'}}));w.localStorage.setItem('inboxy.selectedWorkspace','20000000-0000-4000-8000-000000000001');}
 w.fetch=async(url,opts={})=>{requests.push({url:String(url),body:opts.body});let data=null;const path=new URL(url).pathname;
 if(path.endsWith('/inboxy-mail'))data={providers:{gmail:{label:'Gmail',configured:false,callback:'https://callback.invalid',clientIdSecret:'GOOGLE_MAIL_CLIENT_ID',clientSecretSecret:'GOOGLE_MAIL_CLIENT_SECRET'}},connections:[]};
 else if(path.endsWith('/workspaces'))data=[{id:'20000000-0000-4000-8000-000000000001',name:'Test Operations',revision}];
 else if(path.endsWith('/workspace_members'))data={role:'owner'};
 else if(path.endsWith('/workspace_access'))data=[];
 else if(path.endsWith('/inboxy_load'))data={...snapshot,revision};
 else if(path.endsWith('/inboxy_save')){const body=JSON.parse(opts.body);assert.equal(body.expected_revision,revision);Object.assign(snapshot,body.snapshot);data=++revision;}
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
 w.eval(source);await new Promise(r=>setTimeout(r,100));return {dom,w,requests,snapshot};
}
test('signed-out users see auth and can explore the local demo',async()=>{const {dom,w}=await app();try{assert.match(w.document.querySelector('h1').textContent,/Every handoff/);assert.ok(w.document.querySelector('#auth-form'));w.document.querySelector('#demo-mode').click();assert.equal(w.document.querySelector('h1').textContent,'Operations inbox');assert.equal(w.document.querySelector('#account-access').textContent,'Sign in');}finally{dom.window.close();}});
test('signed-in workspace loads without sample tasks and saves a quick task',async()=>{const {dom,w,requests,snapshot}=await app(true);try{assert.equal(w.document.querySelector('h1').textContent,'Operations inbox');assert.match(w.document.querySelector('.workspace').textContent,/Test Operations/);assert.equal(snapshot.tasks.length,0);w.document.querySelector('#new-task').click();const form=w.document.querySelector('#inline-capture');assert.equal(w.document.querySelector('#detail').open,false);assert.equal(w.document.activeElement,form.elements.title);form.elements.title.value='Wrap pallet 3';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100));assert.equal(snapshot.tasks[0].title,'Wrap pallet 3');assert.ok(requests.some(r=>r.url.endsWith('/rpc/inboxy_save')));assert.equal(w.localStorage.getItem('inboxy.workspace.v1'),null);}finally{dom.window.close();}});

test('group editor customizes color and icon, and empty-group deletion works in the UI',async()=>{const {dom,w}=await app();try{w.document.querySelector('#demo-mode').click();w.document.querySelector('[data-page="groups"]').click();w.document.querySelector('#new-group').click();const form=w.document.querySelector('#group-form');form.elements.name.value='Dispatch';form.elements.color.value='#225588';form.elements.icon.value='◈';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const saved=JSON.parse(w.localStorage.getItem('inboxy.workspace.v1'));const group=saved.groups.find(g=>g.name==='Dispatch');assert.equal(group.color,'#225588');assert.equal(group.icon,'◈');w.document.querySelector(`[data-edit-group="${group.id}"]`).click();w.document.querySelector('#delete-group').click();w.document.querySelector('#delete-group-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(JSON.parse(w.localStorage.getItem('inboxy.workspace.v1')).groups.some(g=>g.id===group.id),false);}finally{dom.window.close();}});
test('email connections show missing setup and an actionable setup guide',async()=>{const {dom,w}=await app(true);try{w.document.querySelector('[data-page="settings"]').click();await new Promise(r=>setTimeout(r,100));assert.match(w.document.querySelector('#mail-integrations').textContent,/Provider setup needed/);assert.equal(w.document.querySelector('[data-mail-connect]').disabled,true);w.document.querySelector('[data-mail-setup]').click();assert.match(w.document.querySelector('#detail').textContent,/GOOGLE_MAIL_CLIENT_SECRET/);}finally{dom.window.close();}});

test('pickup workflow creates selected subtasks and checks them off from the parent', async () => {
 const {dom,w,snapshot}=await app(true);
 try {
  w.document.querySelector('#new-task').click();
  const form=w.document.querySelector('#inline-capture');
  form.elements.title.value='Pickup for ABC Imports';
  form.elements.workflow.value='Pickup';
  form.elements.workflow.dispatchEvent(new w.Event('change'));
  assert.equal(form.elements.workflowStep.length,6);
  form.elements.workflowStep[5].checked=false;
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,100));
  const [parent,...steps]=snapshot.tasks;
  assert.equal(steps.length,5);
  assert.ok(steps.every(step=>step.parentId===parent.id && step.team===parent.team));
  w.document.querySelector(`[data-task="${parent.id}"]`).click();
  w.document.querySelector(`[data-complete-child="${steps[0].id}"]`).click();
  await new Promise(r=>setTimeout(r,100));
  assert.equal(snapshot.tasks.find(task=>task.id===steps[0].id).status,'Completed');
 } finally {dom.window.close();}
});

test('FTZ filter includes admissions and their steps, and the reference is searchable', async () => {
 const {dom,w,snapshot}=await app(true);
 try {
  const doc=w.document;
  const create=(title,workflow='')=>{
   doc.querySelector('#new-task').click();
   const form=doc.querySelector('#inline-capture');
   form.elements.title.value=title;
   form.elements.workflow.value=workflow;
   form.elements.workflow.dispatchEvent(new w.Event('change'));

   form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  };
  create('Schedule ordinary delivery');
  create('Admit inbound cargo','FTZ · Admission (214)');
  await new Promise(resolve=>setTimeout(resolve,100));
  const admission=snapshot.tasks.find(task=>task.title==='Admit inbound cargo');
  doc.querySelector(`[data-task="${admission.id}"] .card-open`).click();
  doc.querySelector('[data-property="ftzReference"]').click();
  const reference=doc.querySelector('#inline-properties [name="ftzReference"]');
  reference.value='214-TEST-001';
  reference.dispatchEvent(new w.Event('change'));
  doc.querySelector('[data-close]').click();
  assert.equal(admission.workflow,'FTZ · Admission (214)');
  assert.equal(snapshot.tasks.filter(task=>task.parentId===admission.id).length,5);
  doc.querySelector('#ftz-filter').click();
  assert.equal(doc.querySelectorAll('#task-results [data-task]').length,1);
  const search=doc.querySelector('#search');
  search.value='214-TEST-001';
  search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.deepEqual([...doc.querySelectorAll('#task-results [data-task]')].map(row=>row.dataset.task),[admission.id]);
 } finally {dom.window.close();}
});

test('custom FTZ steps are used for new tasks and follow-up queue isolates active work', async () => {
 const {dom,w,snapshot}=await app(true);
 try {
  const doc=w.document;
  const submit=form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  doc.querySelector('#customize-ftz').click();
  const editor=doc.querySelector('#ftz-template-form');
  editor.elements.steps.value='Check carrier tally\nConfirm warehouse receipt';
  submit(editor);
  doc.querySelector('[data-close]').click();
  doc.querySelector('#new-task').click();
  const task=doc.querySelector('#inline-capture');
  task.elements.title.value='Follow up on admission';
  task.elements.workflow.value='FTZ · Admission (214)';
  task.elements.workflow.dispatchEvent(new w.Event('change'));

  submit(task);
  await new Promise(resolve=>setTimeout(resolve,100));
  const parent=snapshot.tasks.find(record=>record.title==='Follow up on admission');
  assert.deepEqual(snapshot.tasks.filter(record=>record.parentId===parent.id).map(step=>[step.stepOrder,step.title]),[
   [0,'Check carrier tally'],[1,'Confirm warehouse receipt'],
  ]);
  doc.querySelector(`[data-task="${parent.id}"] .card-open`).click();
  doc.querySelector('#custom-reminder').click();
  const time=doc.querySelector('#inline-properties [name="followUp"]');
  time.value='2020-01-01T09:00';
  time.dispatchEvent(new w.Event('change'));
  doc.querySelector('[data-close]').click();
  const queue=doc.querySelector('#work-queue');
  queue.value='Follow-up due';
  queue.dispatchEvent(new w.Event('change'));
  assert.deepEqual([...doc.querySelectorAll('#task-results [data-task]')].map(row=>row.dataset.task),[parent.id]);
 } finally {dom.window.close();}
});

test('email capture links the original and supports references, a reminder, and inline updates',async()=>{
 const {dom,w,snapshot}=await app(true);
 try {
  const doc=w.document;
  const submit=form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  doc.querySelector('[data-page="inbox"]').click();
  doc.querySelector('#capture').click();
  const emailForm=doc.querySelector('#email-form');
  emailForm.elements.from.value='dispatch@example.invalid';
  emailForm.elements.subject.value='Truck arrival schedule';
  emailForm.elements.body.value='Original carrier message.';
  submit(emailForm);
  doc.querySelector('.mail-row').click();
  doc.querySelector('#email-task').click();
  const form=doc.querySelector('#inline-capture');
  assert.equal(form.elements.title.value,'Truck arrival schedule');
  form.elements.title.value='Confirm truck';
  submit(form);
  for(const [name,value] of Object.entries({customer:'Test customer',ourReference:'OPS-7',customerReference:'PO-240'})){
   doc.querySelector(`[data-property="${name}"]`).click();
   const field=doc.querySelector(`#inline-properties [name="${name}"]`);
   field.value=value;
   field.dispatchEvent(new w.Event('change'));
  }
  doc.querySelector('[data-remind="tomorrow"]').click();
  await new Promise(resolve=>setTimeout(resolve,100));
  const task=snapshot.tasks.find(record=>record.title==='Confirm truck');
  assert.equal(task.customer,'Test customer');
  assert.equal(task.ourReference,'OPS-7');
  assert.equal(task.customerReference,'PO-240');
  assert.equal(task.description,'');
  assert.equal(snapshot.emails[0].taskId,task.id);
  assert.match(task.followUp,/T09:00$/);
  const subtask=doc.querySelector('#inline-subtask');
  subtask.elements.title.value='Confirm dock appointment';
  submit(subtask);
  const note=doc.querySelector('#note-form');
  note.elements.note.value='Carrier confirmed the appointment.';
  submit(note);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(snapshot.tasks.some(record=>record.parentId===task.id && record.title==='Confirm dock appointment'));
  assert.equal(snapshot.tasks.find(record=>record.id===task.id).notes[0].body,'Carrier confirmed the appointment.');
 } finally {dom.window.close();}
});

test('threaded replies reopen the operational loop in Today and can be reviewed',async()=>{
 const task={id:'task-1',title:'Confirm admission tally',team:'Ops',owner:'Unassigned',status:'Waiting',priority:'Normal',waitingOn:'Carrier tally',due:'',followUp:'',dependencies:[],notes:[],activity:[{text:'Task created',date:'2020-01-01T09:00:00Z'}]};
 const emails=[
  {id:'email-1',taskId:task.id,threadId:'thread',connectionId:'mailbox',date:'2020-01-01T08:00:00Z',from:'Sender <sender@example.invalid>',subject:'Pre-alert',body:'Original message'},
  {id:'email-2',taskId:null,threadId:'thread',connectionId:'mailbox',date:'2020-01-02T08:00:00Z',from:'Sender <sender@example.invalid>',subject:'Re: Pre-alert',body:'Revised tally'},
 ];
 const {dom,w}=await app(true,{tasks:[task],emails});
 try{
  const doc=w.document;
  doc.querySelector('[data-page="inbox"]').click();
  assert.equal(doc.querySelectorAll('.mail-row').length,1);
  assert.equal(doc.querySelectorAll('.mail-message').length,0);
  doc.querySelector('.mail-row').click();
  assert.equal(doc.querySelectorAll('.mail-message').length,2);
  assert.ok(doc.querySelector('#open-linked'));
  doc.querySelector('[data-page="today"]').click();
  assert.match(doc.querySelector('.today-grid section').textContent,/Confirm admission tally/);
  doc.querySelector('.today-row').click();
  doc.querySelector('#mark-mail-reviewed').click();
  assert.match(doc.querySelector('.today-grid section').textContent,/Nothing in this queue/);
 }finally{dom.window.close();}
});

test('workspace access can add the same teammate to the assignment list',async()=>{
 const {dom,w,snapshot,requests}=await app(true);
 try{
  const doc=w.document;
  doc.querySelector('[data-page="groups"]').click();
  doc.querySelector('#team-access').click();
  await new Promise(resolve=>setTimeout(resolve,50));
  const form=doc.querySelector('#access-form');
  form.elements.email.value='Dispatch@Example.invalid';
  form.elements.name.value='Dispatch teammate';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(requests.some(r=>r.url.endsWith('/rpc/inboxy_grant_access')&&JSON.parse(r.body).e==='dispatch@example.invalid'));
  assert.equal(snapshot.people[0].name,'Dispatch teammate');
 }finally{dom.window.close();}
});

test('Gmail conversation supports independent actions, review, assignment, completion and bulk Trash',async()=>{
 const initial={id:'mail-a',taskId:null,threadId:'thread-a',connectionId:'gmail-1',provider:'gmail',date:'2026-11-18T10:00:00Z',from:'Dispatch <dispatch@client.invalid>',subject:'Shipment: OPS-7',body:'Please book pickup.\nPlease confirm inventory.\nCutoff: 2026-11-18 16:00'};
 const operation={id:'operation-a',reference:'OPS-7',customer:'Client',route:'Miami',container:'',publicStatus:'Request received',publicUpdate:'',nextUpdate:''};
 const unrelated={...initial,id:'mail-b',threadId:'thread-b',subject:'Thanks',body:'Thanks, received.'};
 const update={...initial,id:'mail-c',threadId:'thread-c',subject:'Shipment: OPS-7',body:'Please reschedule pickup.\nCutoff: 2026-11-18 18:00'};
 const {dom,w,snapshot}=await app(true,{emails:[initial,unrelated,update],shipments:[operation],
  people:[{id:'operator',name:'Operator',email:'operator@example.invalid',role:'Admin'}]});
 try{
  const doc=w.document;
  const click=selector=>doc.querySelector(selector).click();
  const submit=selector=>doc.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  click('[data-page="inbox"]');click('[data-email="mail-a"]');
  for(const index of [0,1]){
   click('[data-new-request="'+index+'"]');
   click('[name="applySuggestions"]');
   if(index===0)doc.querySelector('#inline-capture [name=title]').value='Book confirmed pickup';
   submit('#inline-capture');click('[data-close]');
  }
  click('#mail-back');click('[data-email="mail-c"]');click('[data-review-request="0"]');
  assert.match(doc.querySelector('#proposed-updates').textContent,/Current: 2026-11-18T16:00/);
  click('[data-confirm-change="cutoff"]');click('#apply-mail-update');
  click('[data-close]');click('[data-page="workspace"]');click('[data-view="List"]');
  const [first,second]=[...doc.querySelectorAll('#task-results [data-task]')].map(row=>row.dataset.task).reverse();
  click('[data-task="'+first+'"] [data-claim]');
  const status=doc.querySelector('[data-task="'+first+'"] [data-row-field="status"]');
  status.value='Completed';status.dispatchEvent(new w.Event('change'));
  click('[data-page="inbox"]');
  click('#mail-select-mode');
  click('[data-select-mail="gmail-1:thread-a"]');
  click('[data-select-mail="gmail-1:thread-b"]');
  click('#bulk-mail-action');const folder=doc.querySelector('#mail-folder');folder.value='Trash';folder.dispatchEvent(new w.Event('change'));
  assert.equal(doc.querySelectorAll('.mail-row').length,2);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(snapshot.tasks.length,2);
  assert.equal(snapshot.tasks.find(t=>t.id===first).owner,'Operator');
  assert.equal(snapshot.tasks.find(t=>t.id===first).status,'Completed');
  assert.equal(snapshot.tasks.find(t=>t.id===second).status,'Up next');
  assert.ok(snapshot.tasks.every(t=>t.shipmentId===operation.id));
  assert.ok(snapshot.tasks.some(t=>t.title==='Book confirmed pickup'));
  assert.equal(snapshot.emails.find(m=>m.id==='mail-a').taskIds.length,2);
  assert.equal(snapshot.tasks.filter(t=>t.cutoff==='2026-11-18T18:00').length,1);
  assert.equal(snapshot.emails.filter(m=>m.deletedAt).length,2);
 }finally{dom.window.close();}
});

test('transport template creates a checklist and task card reveals one inline editor on demand',async()=>{
 const {dom,w,snapshot}=await app(true,{groups:[{id:'ops',name:'Ops',description:'',members:[]},{id:'warehouse',name:'Warehouse',description:'',members:[]}]});
 try{
  const doc=w.document;
  const form=doc.querySelector('#inline-capture');
  for(const name of ['Air Import','Air Export','Ocean Import','Ocean Export','Drayage']){
   assert.ok([...form.elements.workflow.options].some(option=>option.value===name));
  }
  form.elements.workflow.value='Drayage';
  form.elements.workflow.dispatchEvent(new w.Event('change'));
  assert.equal(form.querySelector('[data-workflow-steps]').open,false);
  form.elements.workflowStep[0].checked=false;
  form.elements.title.value='Pull container ABC';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  doc.querySelector('#task-results .card-open').click();
  const task=doc.querySelector('#inline-properties');
  assert.equal(task.querySelectorAll('[data-task-field]:not([hidden])').length,0);
  assert.equal(task.querySelector('[data-task-section="details"]').open,false);
  task.querySelector('[data-property="nextAction"]').click();
  task.querySelector('[name="nextAction"]').value='Call terminal';
  task.querySelector('[name="nextAction"]').dispatchEvent(new w.Event('change'));
  assert.match(task.querySelector('[data-property="nextAction"]').textContent,/Call terminal/);
  task.querySelector('[data-property="owner"]').click();
  assert.equal(task.querySelectorAll('[data-task-field]:not([hidden])').length,1);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(snapshot.tasks[0].workflow,'Drayage');
  assert.equal(snapshot.tasks[0].nextAction,'Call terminal');
  assert.equal(snapshot.tasks.filter(item=>item.parentId===snapshot.tasks[0].id).length,4);
  assert.equal(doc.querySelectorAll('#task-results [data-task]').length,1);
  const parent=snapshot.tasks[0];
  doc.querySelector('[data-close]').click();
  doc.querySelector('[data-quick-edit="'+parent.id+'"][data-field="nextAction"]').click();
  const inline=doc.querySelector('.board-inline-editor');
  assert.equal(doc.querySelector('#detail').open,false);
  inline.value='Confirm appointment';
  inline.dispatchEvent(new w.Event('change'));
  doc.querySelector('#task-results .card-open').click();
  const handoff=doc.querySelector('#inline-subtask');
  handoff.elements.title.value='Count received pallets';
  handoff.elements['step-team'].value='Warehouse';
  handoff.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(doc.querySelectorAll('#task-results [data-task]').length,2);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(snapshot.tasks.some(item=>item.parentId===parent.id&&item.team==='Warehouse'&&item.owner==='Unassigned'));

 }finally{dom.window.close();}
});

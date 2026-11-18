import {defaultTypes,priorities,taskLinks,deadline,dateOnly,dueTime,isActionable,mailSuggestions,suggestTaskType,relatedTaskIds} from './planning.js';
import {cloud,startCloud,saveCloud,refreshCloud,logout,accessPanel,mailAction} from './cloud.bundle.js?v=3';
import {TEAMS as DEFAULT_TEAMS,STATUSES,USERS as DEFAULT_USERS,uid,seed,priority,blockedBy,completionIssue,customerSnapshot,parseEmail,moveTask,removeGroup} from './domain.js?v=6';
const KEY='inboxy.workspace.v1';
let state;try{state=JSON.parse(localStorage.getItem(KEY))||seed();if(state.version!==1||!Array.isArray(state.tasks))throw Error();}catch{state=seed();}
function migrateWorkspace(data){
 data.clients ??= [];
 data.taskTypes ??= [...defaultTypes];
 data.groups ??= DEFAULT_TEAMS.map((name,i)=>({id:'group-'+i,name,description:({Ops:'Coordinate requests and shipment handoffs',Warehouse:'Prepare cargo and complete physical work',Accounting:'Charges, invoices and follow-ups',Pricing:'Quotes, rates and approvals'})[name],members:DEFAULT_USERS.filter(n=>n!=='Unassigned'&&data.tasks.some(t=>t.team===name&&t.owner===n))}));
 data.people ??= DEFAULT_USERS.filter(n=>n!=='Unassigned').map((name,i)=>({id:'person-'+i,name,email:'',role:i===0?'Admin':'Member'}));
 return data;
}
migrateWorkspace(state);
let TEAMS=[],USERS=[];
function syncDirectory(){TEAMS=state.groups.map(g=>g.name);USERS=['Unassigned',...state.people.map(p=>p.name)];}
syncDirectory();
let ftzOnly=false, workQueue='';
let customerFilter='',statusFilter='',dueFilter='',typeFilter='',priorityFilter='',operationFilter='',scope='All tasks',groupBy='None';
const selectedTasks=new Set(),selectedThreads=new Set();
let mailActionDraft=null;
let inboxFilter='Inbox',mailQuery='';
let captureStatus='Up next',captureEmailId='';
let page='workspace',view='Board',team='All teams',owner='All owners',query='',attention=false,selectedEmail=state.emails[0]?.id;
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>s==='Unassigned'?'?':s.slice(0,2).toUpperCase();
const fmt=s=>!s?'No date':dateOnly(s)?new Date(s+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const shipment=id=>state.shipments.find(s=>s.id===id);
const options=(values,current)=>values.map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join('');
function toast(s){const dialog=$('#detail');if(dialog.open){let message=dialog.querySelector('[data-feedback]');if(!message){message=document.createElement('div');message.dataset.feedback='true';message.className='notice';message.setAttribute('role','status');dialog.querySelector('.dialog-head').after(message);}message.textContent=s;}$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').style.display='none',3800);}
function save(){if(cloud.workspace){saveCloud(state,cloudSaveError);return true;}try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch{toast('Storage is full or unavailable. Export a backup before closing.');return false;}}
function activity(t,text){t.activity.unshift({text,date:new Date().toISOString()});}
function openDialog(title,body,footer=''){const d=$('#detail');d.innerHTML=`<div class="dialog-head"><h2>${title}</h2><button data-close aria-label="Close dialog">✕</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;if(!d.open)d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();}
const workQueues={
 'Due within 24h':(task,now)=>deadline(task)&&dueTime(deadline(task))<=now+86400000,
 'Overdue':(task,now)=>deadline(task)&&dueTime(deadline(task))<now,
 'Follow-up due':(task,now)=>task.followUp&&+new Date(task.followUp)<=now,
 'Waiting':task=>task.status==='Waiting',
 'Blocked':task=>blockedBy(task,state.tasks).length>0,
 'Unassigned':task=>task.owner==='Unassigned',
};
function taskCustomer(task){
 return state.clients.find(c=>c.id===(task.clientId||shipment(task.shipmentId)?.clientId))?.name||task.customer||shipment(task.shipmentId)?.customer||'';
}
function taskReferences(task){
 return [task.ourReference,task.customerReference,task.ftzReference,shipment(task.shipmentId)?.reference].filter(Boolean);
}
function reminderValue(preset,now=new Date()){
 const date=new Date(now);
 if(preset==='hour')date.setTime(date.getTime()+3600000);
 else{date.setDate(date.getDate()+1);date.setHours(9,0,0,0);}
 const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
 return local.toISOString().slice(0,16);
}
function reminderButtons(){
 return '<button type="button" data-remind="hour">In 1 hour</button><button type="button" data-remind="tomorrow">Tomorrow at 9 AM</button>';
}
function filtered(){
 const now=Date.now(),search=query.trim().toLowerCase(),subjects=new Map();
 if(search)for(const email of state.emails){
  for(const id of taskLinks(email))subjects.set(id,[...(subjects.get(id)||[]),email.subject]);
 }
 return state.tasks.filter(t=>(team==='All teams'||t.team===team)&&(owner==='All owners'||t.owner===owner)
 &&(scope!=='My next actions'||(t.owner===myOwner()&&isActionable(t,now)))
 &&(!typeFilter||t.taskType===typeFilter)
 &&(!priorityFilter||t.priority===priorityFilter)
 &&(!operationFilter||t.shipmentId===operationFilter)
 &&(!ftzOnly||isFtzTask(t))
 &&(!workQueue||(t.status!=='Completed'&&workQueues[workQueue](t,now)))
 &&(!customerFilter||taskCustomer(t)===customerFilter)
 &&(!statusFilter||t.status===statusFilter)
 &&(!dueFilter||[t.cutoff,t.due].some(date=>date?.slice(0,10)===dueFilter))&&(!search||[t.title,t.nextAction,t.description,t.workflow,taskCustomer(t),...taskReferences(t),...(subjects.get(t.id)||[])].join(' ').toLowerCase().includes(search))&&(!attention||priority(t,state.tasks).reasons.some(r=>['Overdue','Follow-up due','Needs owner'].includes(r)))).sort((a,b)=>priority(b,state.tasks,now).score-priority(a,state.tasks,now).score||(dueTime(deadline(a))-dueTime(deadline(b))));}
function render(){
const currentComposer=$('#inline-capture');
const captureDraft=currentComposer&&{
 context:currentComposer.dataset.context,
 title:currentComposer.elements.title.value,
 workflow:currentComposer.elements.workflow.value,
 steps:[...currentComposer.querySelectorAll('[name=workflowStep]')].map(input=>input.checked),
};
const active=state.tasks.filter(t=>t.status!=='Completed');
$('#app').innerHTML=`<div class="shell"><header class="topbar"><div class="glass-welcome"><span class="avatar">N10</span><span>Welcome to <strong>Inboxy</strong><small>Your operations, connected.</small></span></div><input class="search" id="search" aria-label="Search tasks, customers, references" placeholder="Search tasks, customers, references…" value="${esc(query)}"><div class="topbar-right"><span class="demo" data-cloud-status>${cloud.workspace?(cloud.failed?'Not saved · export before reload':cloud.pending?'Saving…':'Shared workspace'):'Local demo'}</span><button id="account-access" class="small">${cloud.workspace?'Account':'Sign in'}</button><span class="avatar">IA</span></div></header><aside class="sidebar"><div class="logo">inboxy<b>↗</b><small>OPERATIONS, CONNECTED</small></div><div class="workspace">${esc(cloud.workspace?.name||'N10 Logistics')} <span>${cloud.workspace?'Shared operations workspace':'Operations workspace · Demo'}</span></div><nav class="nav" aria-label="Workspace"><button data-page="today" class="${page==='today'?'active':''}"><span>Today</span></button><button data-page="workspace" class="${page==='workspace'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 3v18M15 3v18"/></svg> <span>Workspace</span><span class="count">${active.length}</span></button><button data-page="inbox" class="${page==='inbox'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></svg> <span>Email inbox</span><span class="count">${state.emails.filter(e=>!e.taskId).length}</span></button><button data-page="shipments" class="${page==='shipments'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/></svg> <span>Shipments</span></button><button data-page="workload" class="${page==='workload'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 6"/></svg> <span>Team workload</span></button><label>TEAM QUEUES</label>${TEAMS.map(t=>`<button data-team="${esc(t)}" class="${team===t&&page==='workspace'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="4"/></svg> <span>${esc(t)}</span><span class="count">${active.filter(x=>x.team===t).length}</span></button>`).join('')}<label>WORKSPACE</label><button data-page="groups" class="${page==='groups'?'active':''}">＋ <span>Groups & people</span></button><button data-page="settings" class="${page==='settings'?'active':''}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="16" cy="17" r="3" fill="white"/></svg> <span>Connections & data</span></button></nav><footer><span class="avatar">IA</span> ${esc(cloud.user?.email||'Ignacio')}<br><span>Keep every handoff visible.</span></footer></aside><main class="main"><div class="content"><div class="eyebrow">N10 / OPERATIONS</div><div class="heading"><div><h1>${({today:'Today',workspace:team==='All teams'?'Operations inbox':team+' space',inbox:'Email inbox',shipments:'Shipments',workload:'Team workload',settings:'Workspace settings',groups:'Team & groups'})[page]}</h1><p class="muted">${({today:'New replies, deadlines, and follow-ups.',workspace:'',inbox:'Capture requests and keep the original instructions close.',shipments:'Keep tasks, handoffs, and customer updates together.',workload:'Spot overloaded queues and rebalance the work.',settings:'Manage local data and plan your live connections.',groups:'Create your groups. Bring in your people. Give every request a home.'})[page]}</p></div><div class="actions">${page==='groups'?'<button id="new-group">New group</button><button id="new-person">Add assignee</button><button id="team-access" class="primary">Team access</button>':''}${page==='inbox'?'<button id="email-connections">Connections</button><button id="capture">Capture email</button><button id="inbox-sync" class="primary">Sync inbox</button>':''}${page==='shipments'?'<button class="primary" id="new-shipment">＋ New shipment</button>':['groups','inbox'].includes(page)?'':'<button class="primary" id="new-task">＋ New task</button>'}</div></div>${page==='workspace'?`${composerHTML()}${planningBar()}<div class="toolbar"><div class="segments">${['Focus','Board','List','Do next'].map(v=>`<button data-view="${v}" class="${view===v?'active':''}">${v==='Board'?'▦':v==='List'?'☷':'↗'} ${v}</button>`).join('')}</div><div class="filters"><select id="team" aria-label="Filter by team">${options(['All teams',...TEAMS],team)}</select><select id="owner" aria-label="Filter by owner">${options(['All owners',...USERS],owner)}</select><select id="customer-filter" aria-label="Filter by customer"><option value="">All customers</option>${options([...new Set([...state.shipments.map(s=>s.customer),...state.tasks.map(taskCustomer)].filter(Boolean))].sort(),customerFilter)}</select><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option>${options(STATUSES,statusFilter)}</select><input type="date" id="due-filter" aria-label="Filter by due date" title="Filter by due date" value="${esc(dueFilter)}"><select id="work-queue" aria-label="Filter by work queue"><option value="">All work</option>${options(Object.keys(workQueues),workQueue)}</select><button id="ftz-filter" class="small ${ftzOnly?'primary':''}" aria-pressed="${ftzOnly}">FTZ only</button><button id="customize-ftz" class="small">Task templates</button><button id="clear" class="small">Clear filters</button></div></div><div id="task-results">${taskResults()}</div><div class="bottom-note">${attention?'Showing overdue, unassigned, and follow-up-due tasks. ':''}${cloud.workspace?'Shared with your workspace. Team filters are views, not access permissions.':'Local demo: changes stay in this browser. Sign in to use shared data.'}</div>`:page==='today'?todayHTML():page==='inbox'?inboxHTML():page==='shipments'?shipmentsHTML():page==='workload'?workloadHTML():page==='groups'?groupsHTML():settingsHTML()}</div></main><nav class="glass-dock" aria-label="Quick navigation">${[['today','Today'],['workspace','Board'],['inbox','Inbox'],['shipments','Shipments'],['groups','Team']].map(([key,label])=>`<button data-page="${key}" class="${page===key?'active':''}">${label}</button>`).join('')}<button id="dock-add" aria-label="Create task">＋</button></nav></div>`;
 $('#team-access')?.addEventListener('click',()=>cloud.workspace?accountDialog():toast('Sign in to manage workspace access.'));
 $('#account-access').onclick=()=>cloud.workspace?accountDialog():location.reload();document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;if(page==='workspace'){team='All teams';owner='All owners';query='';operationFilter='';attention=false;}render();window.scrollTo({top:0,behavior:'instant'});});document.querySelectorAll('[data-team]').forEach(b=>b.onclick=()=>{team=b.dataset.team;page='workspace';attention=false;render();});
 $('#search').oninput=e=>{query=e.target.value;if(page==='shipments'){const caret=e.target.selectionStart;render();$('#search').focus();$('#search').setSelectionRange(caret,caret);}else if(page!=='workspace'){page='workspace';render();$('#search').focus();}else{$('#task-results').innerHTML=taskResults();bindCards();bindPage();bindDirectory();bindPlanning();}};
 $('#new-task')?.addEventListener('click',()=>focusComposer());$('#new-shipment')?.addEventListener('click',()=>shipmentEditor());$('#capture')?.addEventListener('click',captureEmail);$('#new-group')?.addEventListener('click',()=>groupEditor());$('#new-person')?.addEventListener('click',()=>personEditor());
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});$('#team')?.addEventListener('change',e=>{team=e.target.value;render();});$('#owner')?.addEventListener('change',e=>{owner=e.target.value;render();});$('#attention')?.addEventListener('click',()=>{attention=!attention;view='Do next';render();});$('#clear')?.addEventListener('click',()=>{team='All teams';owner='All owners';query='';customerFilter=statusFilter=dueFilter=workQueue=typeFilter=priorityFilter=operationFilter='';scope='All tasks';groupBy='None';selectedTasks.clear();ftzOnly=false;attention=false;render();});
 $('#customize-ftz')?.addEventListener('click',()=>editFtzTemplates());
 $('#work-queue')?.addEventListener('change',e=>{
  workQueue=e.target.value;attention=false;
  if(workQueue){statusFilter='';view='List';}
  render();
 });
 $('#ftz-filter')?.addEventListener('click',()=>{ftzOnly=!ftzOnly;render();});
 $('#customer-filter')?.addEventListener('change',e=>{customerFilter=e.target.value;render();});
 $('#status-filter')?.addEventListener('change',e=>{statusFilter=e.target.value;render();});
 $('#due-filter')?.addEventListener('change',e=>{dueFilter=e.target.value;render();});
 bindCards();bindPage();bindDirectory();bindPlanning();
 $('#dock-add')?.addEventListener('click',()=>focusComposer());
 if(page==='workspace')bindComposer();
 const composer=$('#inline-capture');
 if(composer&&captureDraft?.context===composer.dataset.context){
  composer.elements.title.value=captureDraft.title;
  composer.elements.workflow.value=captureDraft.workflow;
  composer.elements.workflow.onchange();
  composer.querySelectorAll('[name=workflowStep]').forEach((input,index)=>{input.checked=captureDraft.steps[index]??true;});
 }
 document.querySelectorAll('.sidebar .nav button').forEach(b=>{b.title=b.querySelector('span')?.textContent.trim()||b.textContent.trim().replace(/\s+/g,' ');b.setAttribute('aria-label',b.title);});
}
function checklist(taskId){
 return state.tasks.filter(step=>step.parentId===taskId).sort((a,b)=>(a.stepOrder??Infinity)-(b.stepOrder??Infinity));
}
function nextAction(task){
 return task.nextAction || (task.status!=='Completed'&&checklist(task.id).find(step=>step.status!=='Completed')?.title);
}
function card(t){const blocks=blockedBy(t,state.tasks),children=state.tasks.filter(x=>x.parentId===t.id),emails=conversations().filter(thread=>thread.taskIds.includes(t.id));return `<article class="card operation-card priority-${t.priority.toLowerCase()} ${blocks.length?'has-blockers':''} ${t.status==='Completed'?'is-complete':''}" draggable="true" tabindex="0" role="group" data-task="${t.id}" aria-label="${esc(t.title)}"><div class="card-context"><span class="ref">${esc(taskReferences(t)[0]||'GENERAL REQUEST')}</span><button class="drag-handle" data-drag="${t.id}" aria-label="Drag ${esc(t.title)}" title="Drag to move or reorder" draggable="false">⠿</button></div><button class="card-open"><h3>${esc(t.title)}</h3></button><div class="customer">${esc(taskCustomer(t)||t.team)}${t.parentId?' · Subtask':''}</div><button class="next-action" data-field="nextAction" data-quick-edit="${t.id}"><span>NEXT</span><strong>${esc(nextAction(t)||'Add next action')}</strong><span>↗</span></button>${blocks.length?`<div class="blocked-line">↳ Waiting on ${esc(blocks[0].title)}${blocks.length>1?' +'+(blocks.length-1):''}</div>`:''}<div class="card-signals"><span class="badge ${t.priority}">${esc(t.priority)}${t.priorityOverride?' · Manual':''}</span>${deadline(t)&&dueTime(deadline(t))<Date.now()&&t.status!=='Completed'?'<span class="overdue-pill">Overdue</span>':''}${children.length?`<span>☑ ${children.filter(c=>c.status==='Completed').length}/${children.length}</span>`:''}${emails.length?`<button data-card-email="${t.id}">✉ ${emails.length}</button>`:''}${t.followUp?`<span title="Follow-up">↻ ${esc(fmt(t.followUp))}</span>`:''}</div><div class="card-bottom"><button class="card-owner" data-field="owner" data-quick-edit="${t.id}"><span class="avatar">${esc(initials(t.owner))}</span>${esc(t.owner)}</button><button class="card-due ${dueTime(deadline(t))<Date.now()&&t.status!=='Completed'?'overdue':''}" data-field="${t.cutoff?'cutoff':'due'}" data-quick-edit="${t.id}">${t.cutoff?'Cutoff · '+esc(fmt(t.cutoff)):t.due?esc(fmt(t.due)):'＋ Due date'}</button></div><label class="card-move"><span>Move to</span><select data-move="${t.id}" aria-label="Move ${esc(t.title)} to status">${options(STATUSES,t.status)}</select></label></article>`;}
function taskResults(){const list=filtered();if(view==='List'||view==='Do next')return taskTable(view==='Do next'?list.filter(t=>t.status!=='Completed'):list);if(!list.length&&view!=='Board')return '<div class="panel empty">No tasks match these filters.</div>';if(view==='Focus')return focusHTML(list);if(view==='Board')return `<div class="board-guidance"><span>Drag cards between columns. Drag the grip to move on touch screens.</span><span>Or use “Move to” on any card.</span></div><div class="board">${STATUSES.map(status=>`<section class="column" data-status="${status}" aria-label="${status} column"><div class="column-head"><i class="dot"></i>${status}<span class="number">${list.filter(t=>t.status===status).length}</span><button class="column-add" data-add-status="${status}" aria-label="Add task to ${status}">＋</button></div><div class="column-cards">${list.filter(t=>t.status===status).sort((a,b)=>(a.boardOrder??state.tasks.indexOf(a))-(b.boardOrder??state.tasks.indexOf(b))).map(card).join('')||'<div class="drop-placeholder">Drop a task here</div>'}</div><form class="column-quick-add" data-quick-status="${status}"><input name="title" required maxlength="180" aria-label="New task in ${status}" placeholder="＋ Add a task…"><button type="submit" aria-label="Create task in ${status}">↵</button></form></section>`).join('')}</div>`;return taskTable(list);}
function bindCards(){document.querySelectorAll('[data-task]').forEach(b=>{b.onclick=e=>{if(e.target.closest('button,select,input')&&!e.target.closest('.card-open'))return;taskDetail(b.dataset.task);};b.onkeydown=e=>{if(e.target===b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();taskDetail(b.dataset.task);}};});bindBoard();}
function taskEditor(id){
 const task=state.tasks.find(t=>t.id===id);
 openDialog('Dependencies & sharing',`<div class="task-properties">
  <label class="field">Blocked by<select id="task-dependencies" multiple size="5">${state.tasks.filter(t=>t.id!==id).map(t=>`<option value="${esc(t.id)}" ${task.dependencies.includes(t.id)?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label>
  <label class="check-row"><input id="task-impact" type="checkbox" ${task.impact?'checked':''}> Operational impact</label>
  <label class="check-row"><input id="task-public" type="checkbox" ${task.public?'checked':''}> Show milestone in customer update</label>
  <label class="field">Customer-facing title<input id="task-public-title" value="${esc(task.publicTitle)}"></label>
 </div>`,'<button id="save-task-settings" class="primary">Save</button>');
 $('#save-task-settings').onclick=()=>{
  const dependencies=[...$('#task-dependencies').selectedOptions].map(option=>option.value);
  if(dependencies.some(id=>hasDependencyPath(id,task.id)))return toast('This dependency would create a cycle.');
  if(task.status==='Completed'){
   const issue=completionIssue({...task,dependencies},state.tasks);
   if(issue)return toast(issue);
  }
  Object.assign(task,{dependencies,impact:$('#task-impact').checked,public:$('#task-public').checked,publicTitle:$('#task-public-title').value.trim()});
  activity(task,'Updated dependencies and sharing');save();render();taskDetail(id);
 };
}
function hasDependencyPath(start,target,visited=new Set()){if(!target)return false;if(start===target)return true;if(visited.has(start))return false;visited.add(start);return state.tasks.find(t=>t.id===start)?.dependencies.some(d=>hasDependencyPath(d,target,visited))||false;}
function taskDetail(id,focus){const t=state.tasks.find(t=>t.id===id);if(!t)return;const s=shipment(t.shipmentId),children=checklist(id),threads=conversations().filter(thread=>thread.taskIds.includes(id)),emails=threads.flatMap(thread=>thread.messages),blocks=blockedBy(t,state.tasks);
openDialog('Task',`${taskProperties(t)}${t.parentId?`<p><button class="linkbutton" id="parent-task">↑ Open parent task</button></p>`:''}${blocks.length?`<div class="notice">Waiting on: ${blocks.map(b=>esc(b.title)).join(' · ')}</div>`:''}<details class="quick-more task-follow-up"><summary>${t.followUp?'Reminder · '+esc(fmt(t.followUp)):'Set reminder'}</summary>${t.status==='Completed'?'':`<div class="actions task-reminders">${reminderButtons()}<button id="custom-reminder">Pick a time</button>${t.followUp?'<button id="clear-reminder">Clear reminder</button>':''}</div>`}</details><details class="quick-more task-checklist" ${children.length?'open':''}><summary>Checklist${children.length?' · '+children.filter(x=>x.status==='Completed').length+'/'+children.length:''}</summary><div class="section-title"><h3 class="visually-hidden">Add to checklist</h3>${t.status==='Completed'?'':'<form id="inline-subtask" class="inline-form"><input name="title" required maxlength="180" aria-label="New subtask" placeholder="Add a step…"><button>Add</button></form>'}</div>${children.map(c=>`<div class="check-row"><button class="small" data-complete-child="${c.id}" aria-label="Complete ${esc(c.title)}" ${c.status==='Completed'?'disabled':''}>${c.status==='Completed'?'✓':'○'}</button><span>${esc(c.title)}<small class="muted"> · ${esc(c.team)} / ${esc(c.owner)}</small></span><button data-child="${c.id}" class="small">Open</button></div>`).join('')}</details><details class="quick-more task-thread"><summary>Linked email ${emails.length?' · '+emails.length:''}</summary><div class="section-title"><h3>Conversations</h3><button id="link-email">Link email</button>${pendingReply(t,threads)?'<button id="mark-mail-reviewed">Mark replies reviewed</button>':''}</div>${emails.map(e=>`<div class="note"><strong>${esc(e.subject)}</strong><small>${esc(e.from)}</small><p>${esc(e.body)}</p>${attachmentButtons(e)}<button data-reply="${e.id}">Draft reply ↗</button></div>`).join('')||'<p class="muted">No emails linked to this task.</p>'}</details><details class="quick-more"><summary>Notes${t.notes.length?' · '+t.notes.length:''}</summary>${t.notes.map(n=>`<div class="note">${esc(n.body)}<small>${esc(n.author)} · ${esc(fmt(n.date))}</small></div>`).join('')}<form id="note-form" class="inline-form"><textarea name="note" aria-label="Internal note" required placeholder="Add an internal note…"></textarea><button>Add note</button></form></details><details class="quick-more"><summary>Activity</summary>${t.activity.map(a=>`<p class="muted">${esc(a.text)} · ${esc(fmt(a.date))} ${a.emailId&&state.emails.some(e=>e.id===a.emailId)?`<button data-source-email="${esc(a.emailId)}">Source email</button>`:''}</p>`).join('')||'<p class="muted">No activity yet.</p>'}</details><details class="quick-more"><summary>Task settings</summary><div class="actions"><button id="edit-task">Dependencies & sharing</button>${s?'<button id="share-task">Customer update</button>':''}<button id="delete-task" class="danger">Delete task</button></div></details>`,`${t.status!=='Completed'?'<button id="complete-task" class="primary">Mark complete</button>':''}`);
 bindAttachments();
 document.querySelectorAll('[data-source-email]').forEach(button=>button.onclick=()=>openInboxMessage(button.dataset.sourceEmail));
 $('#mark-mail-reviewed')?.addEventListener('click',()=>{t.mailReviewedAt=new Date().toISOString();save();render();taskDetail(id);});
 $('#edit-task').onclick=()=>taskEditor(id);
 $('#delete-task')?.addEventListener('click',()=>confirmTaskDeletion([id]));
 const properties=$('#inline-properties');
 for(const control of properties.querySelectorAll('input,select,textarea')){
  control.onchange=()=>{
   const key=control.name,value=control.value.trim();
   if(key==='title'&&!value){control.value=t.title;return toast('Enter a task title.');}
   if((t[key]||'')===value&&key!=='priority')return;
   if(key==='status'){
    const issue=moveTask(state.tasks,id,value);
    if(issue){control.value=t.status;return toast(issue);}
   }else t[key]=value;
   if(key==='priority')t.priorityOverride=true;
   activity(t,'Updated '+control.labels[0].textContent.trim().split(/\s+/).slice(0,key==='nextAction'?2:1).join(' ').toLowerCase());
   save();render();
   if(key==='status'){taskDetail(id);return;}
   const updated=document.createElement('template');
   updated.innerHTML=taskProperties(t);
   for(const text of properties.querySelectorAll('[data-property] strong')){
    const property=text.parentElement.dataset.property;
    text.textContent=updated.content.querySelector('[data-property='+property+'] strong').textContent;
   }
   for(const node of properties.querySelectorAll('[data-task-section] > summary,.task-reference-line')){
    const selector=node.parentElement.matches('[data-task-section]')?'[data-task-section='+node.parentElement.dataset.taskSection+'] > summary':'.task-reference-line';
    node.textContent=updated.content.querySelector(selector)?.textContent||'';
    if(node.matches('.task-reference-line'))node.hidden=!node.textContent;
   }
  };
 }
 const showProperty=key=>{
  const field=properties.querySelector('[name='+key+']');
  if(!field)return;
  const selected=field.closest('[data-task-field]');
  for(const editor of properties.querySelectorAll('[data-task-field]'))editor.hidden=editor!==selected;
  for(const chip of properties.querySelectorAll('[data-property]'))chip.setAttribute('aria-expanded',String(chip.dataset.property===key));
  const section=selected.closest('details');
  if(section)section.open=true;
  field.focus();
 };
 properties.querySelectorAll('[data-property]').forEach(chip=>chip.onclick=()=>showProperty(chip.dataset.property));
 properties.onkeydown=event=>{
  if(event.key!=='Enter'||event.target.tagName!=='INPUT')return;
  event.preventDefault();event.target.blur();
 };
 if(focus)showProperty(focus);

const updateReminder=value=>{
  t.followUp=value;activity(t,value?'Follow-up reminder set':'Follow-up reminder cleared');save();render();taskDetail(id);
 };
 document.querySelectorAll('[data-remind]').forEach(button=>button.onclick=()=>updateReminder(reminderValue(button.dataset.remind)));
 $('#clear-reminder')?.addEventListener('click',()=>updateReminder(''));
 $('#custom-reminder')?.addEventListener('click',()=>showProperty('followUp'));
 $('#inline-subtask')?.addEventListener('submit',event=>{
  event.preventDefault();
  const title=event.target.elements.title.value.trim();
  if(!title)return;
  state.tasks.push(newTaskRecord({title,parentId:id,shipmentId:t.shipmentId,team:t.team,owner:t.owner,customer:taskCustomer(t)}));
  activity(t,'Subtask added');save();render();taskDetail(id);$('#inline-subtask input')?.focus();
 });$('#parent-task')?.addEventListener('click',()=>taskDetail(t.parentId));document.querySelectorAll('[data-complete-child]').forEach(button=>button.onclick=()=>{
 const child=state.tasks.find(task=>task.id===button.dataset.completeChild);
 const issue=moveTask(state.tasks,child.id,'Completed');
 if(issue)return toast(issue);
 activity(child,'Marked complete');
 save();render();taskDetail(id);
 });document.querySelectorAll('[data-child]').forEach(b=>b.onclick=()=>taskDetail(b.dataset.child));document.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>draftReply(b.dataset.reply));$('#share-task')?.addEventListener('click',()=>customerView(s.id));$('#link-email').onclick=()=>linkEmail(id);$('#complete-task')?.addEventListener('click',()=>{const issue=moveTask(state.tasks,id,'Completed');if(issue)return toast(issue);activity(t,'Marked complete');save();render();taskDetail(id);toast('Completed — dependent tasks can now move forward');});$('#note-form').onsubmit=e=>{e.preventDefault();const body=new FormData(e.target).get('note').trim();if(!body)return;t.notes.push({body,author:cloud.user?.email||'Ignacio',date:new Date().toISOString()});activity(t,'Internal note added');save();taskDetail(id);};}
function mailKey(email){
 return email.connectionId&&email.threadId?email.connectionId+':'+email.threadId:email.id;
}
function personalKey(name){
 return ['inboxy',name,cloud.workspace?.id||'demo',cloud.user?.id||'local'].join('.');
}
function personalState(name){
 try{return JSON.parse(localStorage.getItem(personalKey(name)))||{};}catch{return {};}
}
function setPersonalState(name,data){
 try{localStorage.setItem(personalKey(name),JSON.stringify(data));return true;}
 catch{toast('Could not save this preference in your browser.');return false;}
}
function conversations(){
 const map=new Map();
 for(const email of state.emails){
  const key=mailKey(email);
  if(!map.has(key))map.set(key,[]);
  map.get(key).push(email);
 }
 return [...map].map(([key,messages])=>{
  messages.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||a.id.localeCompare(b.id));
  return {key,messages,latest:messages[0],taskIds:relatedTaskIds(messages),shipmentIds:[...new Set(messages.flatMap(message=>message.shipmentIds||[]))]};
 }).sort((a,b)=>String(b.latest.date||'').localeCompare(String(a.latest.date||'')));
}
function pendingReply(task,threads){
 const latest=threads.find(thread=>!thread.latest.deletedAt&&thread.taskIds.includes(task.id))?.latest;
 return latest&&new Date(latest.date)>new Date(task.mailReviewedAt||task.activity.at(-1)?.date||0)?latest:null;
}
function inboxHTML(){
 const metadata=personalState('inbox-view'),query=mailQuery.trim().toLowerCase();
 const threads=conversations().filter(thread=>{
  if(thread.latest.deletedAt||inboxFilter==='Trash')return Boolean(thread.latest.deletedAt)&&inboxFilter==='Trash'&&(!query||thread.messages.some(m=>[m.from,m.subject,m.body].join(' ').toLowerCase().includes(query)));
  const archived=metadata[thread.key]?.latestId===thread.latest.id;
  if(inboxFilter==='Archived'? !archived : archived)return false;
  if(inboxFilter==='Unlinked'&&thread.taskIds.length)return false;
  if(inboxFilter==='Linked'&&!thread.taskIds.length)return false;
  return !query||thread.messages.some(m=>[m.from,m.subject,m.body].join(' ').toLowerCase().includes(query));
 });
 const thread=threads.find(item=>item.messages.some(m=>m.id===selectedEmail))||threads[0];
 const e=thread?.latest;
 const tasks=state.tasks.filter(t=>thread?.taskIds.includes(t.id));
 const reviewTasks=thread?emailUpdateCandidates(thread):[];
 const toolbar=`<div class="inbox-toolbar">
  <input type="search" id="mail-search" aria-label="Search email" placeholder="Search sender, subject, or message" value="${esc(mailQuery)}">
  <div class="segments" aria-label="Inbox filters">${['Inbox','Unlinked','Linked','Archived','Trash'].map(label=>`<button data-mail-filter="${label}" class="${label===inboxFilter?'active':''}">${label}</button>`).join('')}</div>
  <span id="inbox-sync-state" class="muted" role="status"></span>
 </div>`;
 const list=threads.map(item=>`<div class="mail-select-row"><input type="checkbox" data-select-mail="${esc(item.key)}" aria-label="Select ${esc(item.latest.subject)}" ${selectedThreads.has(item.key)?'checked':''}><button class="mail-row ${item===thread?'selected':''}" data-email="${esc(item.latest.id)}">
  <small>${esc(item.latest.from)} <time>${esc(fmt(item.latest.date))}</time></small>
  <strong>${esc(item.latest.subject)}</strong>
  <span class="mail-preview">${esc(item.latest.body?.replace(/\s+/g,' ').slice(0,130))}</span>
  <span class="mail-row-meta">${item.taskIds.length?item.taskIds.length+' linked action(s)':'Unlinked'}${item.messages.length>1?' · '+item.messages.length+' messages':''}</span>
 </button></div>`).join('');
 return `${toolbar}<div class="actions selection-bar"><label><input type="checkbox" id="select-mail" ${threads.length&&threads.every(item=>selectedThreads.has(item.key))?'checked':''}> Select visible</label><span>${threads.filter(item=>selectedThreads.has(item.key)).length} selected</span><button id="bulk-mail-action">${inboxFilter==='Trash'?'Restore selected':'Move selected to Trash'}</button></div><div class="mail operator-inbox">
  <div class="mail-list">${list||'<p class="empty">No conversations match.</p>'}</div>
  <section class="mail-body" aria-label="Conversation">${e?`<header class="conversation-header">
   <span class="muted">${thread.messages.length} ${thread.messages.length===1?'message':'messages'}</span>
   <h2>${esc(e.subject)}</h2>
   <div class="actions">
    <button class="primary" id="email-reply">${e.connectionId?'Reply':'Draft reply'}</button>
    ${inboxFilter==='Trash'?'':'<button id="email-task">Create task</button><button id="email-link">Link task</button><button id="email-link-operation">Link operation</button>'}
    ${!e.connectionId&&inboxFilter!=='Trash'?'<button id="email-edit">Edit captured email</button>':''}
    <button id="email-trash">${inboxFilter==='Trash'?'Restore':'Move to Trash'}</button>
    ${inboxFilter==='Trash'?'':`<button id="email-archive">${inboxFilter==='Archived'?'Restore to inbox':'Archive in Inboxy'}</button>`}
   </div>
  </header>
  ${tasks.map((t,index)=>`<div class="actions"><button ${index===0?'id="open-linked"':''} data-open-linked="${esc(t.id)}">${esc(t.title)}</button><button data-unlink-task="${esc(t.id)}" aria-label="Unlink ${esc(t.title)}">Unlink</button></div>`).join('')}
  ${thread.shipmentIds.map(id=>`<span class="actions"><button data-email-operation="${esc(id)}">${esc(shipment(id)?.reference)}</button><button data-unlink-operation="${esc(id)}">Unlink operation</button></span>`).join('')}
  ${inboxFilter==='Trash'?'':emailReview(e,reviewTasks)}
  ${inboxFilter!=='Trash'&&captureEmailId===e.id?composerHTML(e):''}
  ${thread.messages.map((message,index)=>`<details class="mail-message" ${(index===0||message.id===selectedEmail)?'open':''}><summary><strong>${esc(message.from)}</strong><time>${esc(fmt(message.date))}</time></summary><pre>${esc(message.body)}</pre>${attachmentButtons(message)}</details>`).join('')}
  `:'<p class="muted">Select a conversation to review.</p>'}</section>
 </div>${state.drafts.length?`<details class="quick-more mailbox-drafts"><summary>Saved drafts · ${state.drafts.length}</summary>${state.drafts.map(d=>`<div class="panel"><strong>${esc(d.subject)}</strong><p class="muted">${esc(d.to)} · ${esc(fmt(d.date))}</p><p style="white-space:pre-wrap">${esc(d.body)}</p>${state.emails.some(e=>e.id===d.emailId)?`<button data-resume-draft="${esc(d.id)}">Continue draft</button>`:''}</div>`).join('')}</details>`:''}`;
}
function bindInbox(){
 const search=$('#mail-search');
 if(!search)return;
 const thread=conversations().find(item=>item.latest.id===$('.mail-row.selected')?.dataset.email);
 const e=thread?.latest;
 search.oninput=()=>{
  const caret=search.selectionStart;
  mailQuery=search.value;render();
  const next=$('#mail-search');next.focus();next.setSelectionRange(caret,caret);
 };
 document.querySelectorAll('[data-mail-filter]').forEach(button=>button.onclick=()=>{inboxFilter=button.dataset.mailFilter;selectedThreads.clear();render();});
 document.querySelectorAll('[data-email]').forEach(button=>button.onclick=()=>{selectedEmail=button.dataset.email;captureEmailId='';mailActionDraft=null;render();});
 document.querySelectorAll('[data-open-linked]').forEach(button=>button.onclick=()=>taskDetail(button.dataset.openLinked));
 document.querySelectorAll('[data-unlink-task]').forEach(button=>button.onclick=()=>{
  for(const message of thread.messages){message.taskIds=taskLinks(message).filter(id=>id!==button.dataset.unlinkTask);message.taskId=null;}
  save();render();
 });
 document.querySelectorAll('[data-email-operation]').forEach(button=>button.onclick=()=>operationDetail(button.dataset.emailOperation));
 document.querySelectorAll('[data-unlink-operation]').forEach(button=>button.onclick=()=>{
  for(const message of thread.messages)message.shipmentIds=(message.shipmentIds||[]).filter(id=>id!==button.dataset.unlinkOperation);
  save();render();
 });
 bindEmailActions(thread,thread?emailUpdateCandidates(thread):[]);
 $('#email-task')?.addEventListener('click',()=>startEmailTask(e));
 $('#email-reply')?.addEventListener('click',()=>draftReply(e.id));
 $('#email-archive')?.addEventListener('click',()=>{
  const metadata=personalState('inbox-view');
  if(inboxFilter==='Archived')delete metadata[thread.key];
  else metadata[thread.key]={latestId:thread.latest.id};
  if(setPersonalState('inbox-view',metadata))render();
 });
 document.querySelectorAll('[data-resume-draft]').forEach(button=>button.onclick=()=>{
  const draft=state.drafts.find(d=>d.id===button.dataset.resumeDraft);
  draftReply(draft.emailId,draft);
 });
 $('#email-link')?.addEventListener('click',()=>{
  openDialog('Link conversation',`<form id="existing-form"><label class="field">Task<select name="task">${state.tasks.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select></label></form>`,'<button class="primary" type="submit" form="existing-form">Link task</button>');
  $('#existing-form').onsubmit=event=>{
   event.preventDefault();
   const id=new FormData(event.target).get('task');
   if(!id)return toast('Create a task first.');
   addMailLink(e,id);save();$('#detail').close();render();
  };
 });
 showInboxSync();
}
function todayHTML(){
 const now=Date.now(),threads=conversations();
 const list=state.tasks.filter(t=>t.status!=='Completed');
 const rows=(tasks,reason)=>tasks.map(task=>`<article class="today-row" data-task="${esc(task.id)}" tabindex="0">
  <div><strong>${esc(task.title)}</strong><small>${esc([taskCustomer(task),task.waitingOn||task.owner,reason(task)].filter(Boolean).join(' · '))}</small></div>
  <div class="actions"><button data-today-assign="${esc(task.id)}">Assign</button><button data-today-snooze="${esc(task.id)}">Snooze</button><button data-today-done="${esc(task.id)}">Done</button></div>
 </article>`).join('')||'<p class="muted">Nothing in this queue.</p>';
 const replies=list.filter(t=>pendingReply(t,threads));
 const followups=list.filter(t=>t.followUp&&+new Date(t.followUp)<=now);
 const due=list.filter(t=>deadline(t)&&dueTime(deadline(t))<=now+86400000).sort((a,b)=>dueTime(deadline(a))-dueTime(deadline(b)));
 const waiting=list.filter(t=>t.status==='Waiting'&&!replies.includes(t)&&!followups.includes(t));
 return `<div class="today-grid">
  <section class="panel"><h2>New replies <small>${replies.length}</small></h2>${rows(replies,t=>pendingReply(t,threads).subject)}</section>
  <section class="panel"><h2>Follow up <small>${followups.length}</small></h2>${rows(followups,t=>fmt(t.followUp))}</section>
  <section class="panel"><h2>Due in 24 hours or overdue <small>${due.length}</small></h2>${rows(due,t=>fmt(deadline(t)))}</section>
  <section class="panel"><h2>Waiting <small>${waiting.length}</small></h2>${rows(waiting,t=>t.followUp?fmt(t.followUp):'No follow-up set')}</section>
 </div>`;
}
function bindToday(){
 document.querySelectorAll('[data-today-assign]').forEach(b=>b.onclick=()=>taskDetail(b.dataset.todayAssign,'owner'));
 document.querySelectorAll('[data-today-snooze]').forEach(b=>b.onclick=()=>{
  const task=state.tasks.find(t=>t.id===b.dataset.todaySnooze);
  task.followUp=reminderValue('tomorrow');
  activity(task,'Follow-up moved to tomorrow');save();render();toast('Follow-up tomorrow at 9 AM');
 });
 document.querySelectorAll('[data-today-done]').forEach(b=>b.onclick=()=>{
  const task=state.tasks.find(t=>t.id===b.dataset.todayDone);
  const issue=moveTask(state.tasks,task.id,'Completed');
  if(issue)return toast(issue);
  activity(task,'Marked complete');save();render();
 });
}
function captureEmail(){openDialog('Capture an email',`<div class="notice">Plain-text .eml imports only; attachments and encoded email formats are not imported. You can also paste the message below.</div><p><input id="eml" type="file" accept=".eml,text/plain" aria-label="Import plain-text email"></p><form id="email-form" class="form-grid"><label class="field full">From<input name="from" required placeholder="Name <email@example.com>"></label><label class="field full">Subject<input name="subject" required></label><label class="field full">Email body<textarea name="body" required></textarea></label></form>`,`<button class="primary" type="submit" form="email-form">Capture email</button>`);$('#eml').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>1000000)return toast('Use a plain-text email under 1 MB.');try{const mail=parseEmail(await file.text());const f=$('#email-form');for(const k of ['from','subject','body'])f.elements[k].value=mail[k];toast('Email loaded — review and capture');}catch(err){toast(err.message);}};$('#email-form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));if(!data.subject.trim()||!data.body.trim())return;const email={...data,id:uid(),date:new Date().toISOString(),taskId:null};state.emails.unshift(email);selectedEmail=email.id;save();$('#detail').close();render();toast('Email captured');};}
function linkEmail(taskId){openDialog('Link conversation',`<form id="link-form" class="form-grid"><label class="field full">Captured email<select name="email">${state.emails.filter(e=>!e.deletedAt&&!taskLinks(e).includes(taskId)).map(e=>`<option value="${e.id}">${esc(e.subject)}</option>`).join('')}</select></label></form>`,`<button type="submit" form="link-form" class="primary">Link email</button>`);$('#link-form').onsubmit=e=>{e.preventDefault();const email=state.emails.find(x=>x.id===new FormData(e.target).get('email'));if(!email)return toast('Capture an email first.');addMailLink(email,taskId);save();taskDetail(taskId);};}
function draftReply(emailId,draft){const e=state.emails.find(x=>x.id===emailId);if(e?.connectionId&&cloud.workspace)return connectedReply(e,draft);openDialog('Draft a reply',`<div class="notice">This is a local draft. You can open it in your email app to review and send. Inboxy does not send or sync replies yet.</div><form id="reply-form" class="form-grid" style="margin-top:18px"><label class="field full">To<input name="to" type="email" required value="${esc(draft?.to||e.from.match(/<([^>]+)>/)?.[1]||e.from)}"></label><label class="field full">Subject<input name="subject" required value="${esc(draft?.subject||(/^re:/i.test(e.subject)?e.subject:'Re: '+e.subject))}"></label><label class="field full">Message<textarea name="body" required style="min-height:180px">${esc(draft?.body)}</textarea></label></form>`,`<button id="open-mail">Open in email app</button><button class="primary" type="submit" form="reply-form">Save draft</button>`);const read=()=>Object.fromEntries(new FormData($('#reply-form')));$('#open-mail').onclick=()=>{if(!$('#reply-form').reportValidity())return;const d=read();location.href=`mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;};$('#reply-form').onsubmit=ev=>{ev.preventDefault();if(draft)Object.assign(draft,read(),{date:new Date().toISOString()});else state.drafts.unshift({...read(),id:uid(),emailId,date:new Date().toISOString()});save();$('#detail').close();render();toast('Draft saved locally — not sent');};}
function shipmentsHTML(){const matches=state.shipments.filter(s=>[s.reference,s.customer,s.route,s.container,state.clients.find(c=>c.id===s.clientId)?.name].join(' ').toLowerCase().includes(query.trim().toLowerCase()));return `<div class="shipment-grid">${matches.map(s=>{const tasks=state.tasks.filter(t=>t.shipmentId===s.id),done=tasks.filter(t=>t.status==='Completed').length;return `<section class="panel"><span class="eyebrow">${esc(s.reference)}</span><h2>${esc(s.customer)}</h2><p class="muted">${esc(s.route)}<br>${esc(s.container||'No container reference')}</p><span class="badge">${esc(s.publicStatus)}</span><div class="progress"><i style="width:${tasks.length?done/tasks.length*100:0}%"></i></div><p class="muted">${done} of ${tasks.length} tasks complete · ${tasks.filter(t=>blockedBy(t,state.tasks).length).length} blocked</p><div class="actions"><button data-shipment="${s.id}">View work</button><button data-customer="${s.id}">Customer update ↗</button><button data-edit-shipment="${s.id}" aria-label="Edit ${esc(s.reference)}">Edit</button></div></section>`;}).join('')}</div>`;}
function shipmentEditor(id,clientId=''){const s=shipment(id)||{reference:'',customer:'',route:'',container:'',clientId,publicStatus:'Request received',publicUpdate:'',nextUpdate:''};openDialog(id?'Edit shipment':'New shipment',`<form id="shipment-form" class="form-grid"><label class="field">Client<select name="clientId">${clientOptions(s.clientId)}</select></label>${[['reference','Reference'],['customer','Customer'],['route','Route'],['container','Container / booking reference'],['publicStatus','Customer-facing status']].map(([k,l])=>`<label class="field">${l}<input name="${k}" value="${esc(s[k])}" ${['reference','publicStatus'].includes(k)?'required':''}></label>`).join('')}<label class="field">Next customer update<input name="nextUpdate" type="datetime-local" value="${esc(s.nextUpdate)}"></label><label class="field full">Customer-facing update<textarea name="publicUpdate">${esc(s.publicUpdate)}</textarea></label></form>`,`${id?'<button id="delete-operation" class="danger">Delete operation</button>':''}<button class="primary" form="shipment-form" type="submit">Save shipment</button>`);$('#delete-operation')?.addEventListener('click',()=>{
 if(!confirm('Delete this operation? Its tasks and emails will remain in the workspace.'))return;
 for(const t of state.tasks.filter(t=>t.shipmentId===id)){t.customer=taskCustomer(t);t.shipmentId='';t.ourReference||=s.reference;activity(t,'Operation removed');}
 for(const mail of state.emails)mail.shipmentIds=(mail.shipmentIds||[]).filter(key=>key!==id);
 state.shipments=state.shipments.filter(x=>x.id!==id);if(operationFilter===id)operationFilter='';save();$('#detail').close();render();
});$('#shipment-form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.customer=state.clients.find(c=>c.id===data.clientId)?.name||data.customer.trim();if(!data.reference.trim()||!data.customer)return toast('Enter a reference and choose or enter a customer.');Object.keys(data).forEach(k=>data[k]=data[k].trim());if(state.shipments.some(x=>x.id!==id&&x.reference.toLowerCase()===data.reference.toLowerCase()))return toast('That shipment reference already exists.');if(id)Object.assign(s,data);else state.shipments.push({...data,id:uid()});save();$('#detail').close();render();toast('Shipment saved');};}
function publicHTML(snapshot){return `<div class="public-preview"><div class="eyebrow">N10 LOGISTICS · SHIPMENT UPDATE</div><h2>${esc(snapshot.reference)}</h2><p class="muted">${esc(snapshot.customer)}</p><h3>${esc(snapshot.status)}</h3><p>${esc(snapshot.update||'An update will be provided shortly.')}</p>${snapshot.milestones.map(m=>`<div class="milestone"><span>${esc(m.title)}</span><strong>${esc(m.status)}</strong></div>`).join('')}<p class="muted">Next update: ${esc(fmt(snapshot.nextUpdate))}</p><small class="muted">Snapshot generated ${esc(fmt(new Date().toISOString()))}. This is not live tracking.</small></div>`;}
function customerView(id){const s=shipment(id),snap=customerSnapshot(s,state.tasks);openDialog('Customer update preview',`<div class="notice" style="margin-bottom:18px">Only the approved fields below are exported. Internal notes, assignees, rates, email bodies, and private tasks are excluded. This version exports a snapshot; secure live links are not available yet.</div>${publicHTML(snap)}`,`<button id="edit-public">Edit update</button><button id="copy-public">Copy update</button><button id="export-public" class="primary">Download customer update</button>`);$('#edit-public').onclick=()=>shipmentEditor(id);$('#copy-public').onclick=async()=>{const text=[snap.reference+' — '+snap.customer,snap.status,snap.update,...snap.milestones.map(m=>m.title+': '+m.status),'Next update: '+fmt(snap.nextUpdate)].join('\n\n');try{await navigator.clipboard.writeText(text);toast('Customer update copied');}catch{toast('Clipboard unavailable. Download the update instead.');}};$('#export-public').onclick=()=>download(`${s.reference.replace(/[^a-z0-9_-]/gi,'-')}-update.html`,`<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shipment update</title><style>body{font:15px/1.7 system-ui;color:#244439;max-width:650px;margin:60px auto;padding:24px}h2{font-size:30px}.milestone{display:flex;justify-content:space-between;border-bottom:1px solid #dde5dd;padding:14px 0}.muted{color:#657768}.eyebrow{font-size:12px;letter-spacing:2px}</style>${publicHTML(snap)}</html>`,'text/html');}
function workloadHTML(){const active=state.tasks.filter(t=>t.status!=='Completed');return `<div class="notice">Workload reflects this workspace. Team queues filter work; account access is managed separately.</div><div class="shipment-grid" style="margin-top:20px">${TEAMS.map(tm=>{const list=active.filter(t=>t.team===tm);return `<section class="panel"><div class="eyebrow">${esc(tm)}</div><h2>${list.length} open tasks</h2>${USERS.filter(u=>list.some(t=>t.owner===u)).map(u=>`<div class="loadbar"><strong>${esc(u)}</strong><div class="progress"><i style="width:${Math.min(100,list.filter(t=>t.owner===u).length/Math.max(1,...USERS.map(x=>active.filter(t=>t.owner===x).length))*100)}%"></i></div><span>${list.filter(t=>t.owner===u).length} tasks</span></div>`).join('')}<p class="muted">${list.filter(t=>dueTime(deadline(t))<Date.now()).length} overdue · ${list.filter(t=>blockedBy(t,state.tasks).length).length} blocked</p><button data-queue="${esc(tm)}">Open ${esc(tm)} queue →</button></section>`;}).join('')}</div>`;}
function settingsHTML(){return `<div class="panel"><h2>Mailbox connections</h2><div id="mail-integrations"></div></div><div class="panel"><h2>Your workspace data</h2><p class="muted">${cloud.workspace?'Changes are saved to Supabase and shared with workspace members. Export a backup whenever you need a copy.':'Changes stay in this browser. Sign in to use a shared workspace.'}</p><div class="actions"><button id="export-data">Export workspace backup</button><button id="import-data">Restore backup</button><input id="backup-file" type="file" accept="application/json,.json" hidden>${cloud.workspace?'':'<button id="reset-data" class="danger">Reset sample workspace</button>'}</div></div>`;}

function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bindPage(){if(page==='inbox')bindInbox();if(page==='today')bindToday();if(page==='inbox'&&$('#inline-capture'))bindComposer(state.emails.find(email=>email.id===captureEmailId));if(page==='settings')renderMailPanel();$('#email-connections')?.addEventListener('click',()=>{page='settings';render();});document.querySelectorAll('[data-shipment]').forEach(b=>b.onclick=()=>operationDetail(b.dataset.shipment));document.querySelectorAll('[data-customer]').forEach(b=>b.onclick=()=>customerView(b.dataset.customer));document.querySelectorAll('[data-edit-shipment]').forEach(b=>b.onclick=()=>shipmentEditor(b.dataset.editShipment));document.querySelectorAll('[data-queue]').forEach(b=>b.onclick=()=>{page='workspace';team=b.dataset.queue;attention=false;render();});$('#export-data')?.addEventListener('click',()=>download('inboxy-backup.json',JSON.stringify(state,null,2),'application/json'));$('#import-data')?.addEventListener('click',()=>$('#backup-file').click());$('#backup-file')?.addEventListener('change',async ev=>{const file=ev.target.files[0];if(!file)return;if(file.size>5000000)return toast('Backup must be under 5 MB.');try{const data=JSON.parse(await file.text());validateBackup(data);if(!confirm('Replace this workspace with this backup? Export your current data first if needed.'))return;state=migrateWorkspace(data);syncDirectory();save();render();toast('Backup restored');}catch{toast('Invalid backup. Current workspace was kept.');}});$('#reset-data')?.addEventListener('click',()=>{if(!confirm('Replace all local changes with sample data? Export a backup first if needed.'))return;state=migrateWorkspace(seed());syncDirectory();save();render();toast('Sample workspace restored');});}
function validateBackup(data){if(data.groups&&(!Array.isArray(data.groups)||!data.groups.length||data.groups.some(g=>typeof g.id!=='string'||typeof g.name!=='string'||!g.name.trim()||typeof g.description!=='string'||!Array.isArray(g.members)||g.members.some(m=>typeof m!=='string'))||new Set(data.groups.map(g=>g.name.toLowerCase())).size!==data.groups.length))throw Error();if(data.people&&(!Array.isArray(data.people)||data.people.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||typeof p.email!=='string'||!['Admin','Member'].includes(p.role))||new Set(data.people.map(p=>p.name.toLowerCase())).size!==data.people.length))throw Error();if(data.version!==1||!['tasks','shipments','emails','drafts'].every(k=>Array.isArray(data[k])))throw Error();const ids=new Set();for(const x of [...data.tasks,...data.shipments,...data.emails,...data.drafts]){if(typeof x.id!=='string'||!/^[a-zA-Z0-9-]+$/.test(x.id)||ids.has(x.id))throw Error();ids.add(x.id);}const tasks=new Set(data.tasks.map(t=>t.id)),ships=new Set(data.shipments.map(s=>s.id));for(const t of data.tasks){if(!['title','description','nextAction','owner','team','status','priority','due','followUp'].every(k=>typeof t[k]==='string')||!(data.groups?.map(g=>g.name)||DEFAULT_TEAMS).includes(t.team)||!STATUSES.includes(t.status)||!['Unassigned',...(data.people?.map(p=>p.name)||DEFAULT_USERS)].includes(t.owner)||!['Urgent','High','Normal','Low'].includes(t.priority)||!Array.isArray(t.notes)||!Array.isArray(t.activity)||!Array.isArray(t.dependencies)||t.dependencies.some(id=>!tasks.has(id))||(t.parentId&&!tasks.has(t.parentId))||(t.shipmentId&&!ships.has(t.shipmentId)))throw Error();}for(const t of data.tasks){let p=t.parentId;const seen=new Set([t.id]);while(p){if(seen.has(p))throw Error();seen.add(p);p=data.tasks.find(x=>x.id===p)?.parentId;}const walk=(id,path)=>{if(path.has(id))throw Error();const next=new Set([...path,id]);data.tasks.find(x=>x.id===id).dependencies.forEach(d=>walk(d,next));};walk(t.id,new Set());}for(const s of data.shipments)if(!['reference','customer','route','container','publicStatus','publicUpdate','nextUpdate'].every(k=>typeof s[k]==='string'))throw Error();for(const e of data.emails)if(!['from','subject','body','date'].every(k=>typeof e[k]==='string')||(e.taskId&&!tasks.has(e.taskId)))throw Error();}
let appReady=false;startCloud(loadCloudState,()=>{appReady=true;render();});setInterval(()=>{if(appReady&&!$('#detail').open&&page==='workspace'&&document.activeElement?.tagName!=='INPUT')render();},60000);

function focusHTML(list){const active=list.filter(t=>t.status!=='Completed'),first=active[0],rest=active.slice(1);return `<div class="focus-layout"><section class="action-stream"><div class="section-kicker"><span>01 / THE NEXT MOVE</span><span>Ranked by operational impact</span></div>${first?`<article class="spotlight" data-task="${first.id}" role="button" tabindex="0"><div class="spotlight-top"><span class="live-pill">PRIORITY ${esc(first.priority.toUpperCase())}</span><span>${esc(shipment(first.shipmentId)?.reference||'GENERAL REQUEST')}</span></div><h2>${esc(first.title)}</h2><p>${esc(first.nextAction||'Set the next action to move this forward.')}</p><div class="spotlight-footer"><span class="avatar">${esc(initials(first.owner))}</span><span>${esc(first.owner)}<small>${esc(first.team)}</small></span><span class="spotlight-reason">${esc(priority(first,state.tasks).reasons.slice(0,2).join(' · '))}</span><span class="arrow-disc">↗</span></div></article>`:'<div class="panel"><h2>A clear runway.</h2><p class="muted">No open work in this view.</p></div>'}<div class="section-kicker next-kicker"><span>02 / ON YOUR RADAR</span><span>${rest.length} open actions</span></div><div class="radar-list">${rest.map((t,i)=>`<button class="radar-row" data-task="${t.id}"><span class="radar-number">${String(i+2).padStart(2,'0')}</span><span class="radar-main"><strong>${esc(t.title)}</strong><small>${esc(shipment(t.shipmentId)?.reference||'General request')} <i>·</i> ${esc(t.team)} <i>·</i> ${esc(t.owner)}</small></span><span class="radar-status">${blockedBy(t,state.tasks).length?'Blocked':esc(t.status)}</span><span class="radar-arrow">↗</span></button>`).join('')}</div></section><aside class="team-orbit"><div class="section-kicker"><span>YOUR SPACES</span><button id="manage-spaces">Manage ↗</button></div>${state.groups.map((g,i)=>{const ts=state.tasks.filter(t=>t.team===g.name&&t.status!=='Completed');return `<button class="space-lane" data-queue="${esc(g.name)}"><span class="space-id">${String(i+1).padStart(2,'0')}</span><span class="space-main"><strong>${esc(g.name)}</strong><small>${g.members.length} ${g.members.length===1?'person':'people'} · ${ts.filter(t=>blockedBy(t,state.tasks).length).length} blocked</small></span><span class="space-total">${ts.length}</span></button>`;}).join('')}<div class="handoff-note"><span>↳</span><h3>Nothing falls between teams.</h3><p>Link the next action to its owner. Dependencies keep handoffs visible until the work is done.</p><button id="focus-new-group">Create a group +</button></div></aside></div>`;}
function groupsHTML(){return `<div class="directory-intro"><span class="directory-label">YOUR WORKSPACE, YOUR STRUCTURE</span><p>No preset departments. Build the groups that match the way you work.</p></div><div class="group-grid">${state.groups.map((g,i)=>{const tasks=state.tasks.filter(t=>t.team===g.name&&t.status!=='Completed');return `<article class="group-tile" style="--group-color:${groupColor(g)}"><div class="group-tile-top"><span class="group-number group-symbol">${esc(g.icon||'↗')}</span><button data-edit-group="${esc(g.id)}" aria-label="Edit ${esc(g.name)}">↗</button></div><div class="group-progress-ring" style="--completion:${state.tasks.filter(t=>t.team===g.name).length?Math.round(state.tasks.filter(t=>t.team===g.name&&t.status==='Completed').length/state.tasks.filter(t=>t.team===g.name).length*100):0}%"><span><b>${state.tasks.filter(t=>t.team===g.name).length?Math.round(state.tasks.filter(t=>t.team===g.name&&t.status==='Completed').length/state.tasks.filter(t=>t.team===g.name).length*100):0}%</b><small>complete</small></span></div><h2>${esc(g.name)}</h2><p>${esc(g.description||'Your team’s dedicated space.')}</p><div class="group-members">${g.members.slice(0,5).map(n=>`<span class="avatar" title="${esc(n)}">${esc(initials(n))}</span>`).join('')}<small>${g.members.length?g.members.length+(g.members.length===1?' person':' people'):'Add your people'}</small></div><div class="group-bottom"><span><b>${tasks.length}</b> open actions</span><button data-queue="${esc(g.name)}">Enter space →</button></div></article>`;}).join('')}<button class="group-create" id="tile-new-group"><span>＋</span><strong>Create a group</strong><small>Any team. Any workflow.</small></button></div><div class="people-heading"><div><span class="section-kicker">WORKSPACE DIRECTORY</span><h2>The people behind the work.</h2></div><button id="directory-add-person">＋ Add person</button></div><div class="notice">Assignment profiles organize work. Manage real sign-in access separately under Account. Profile roles do not grant account permissions.</div><div class="people-list">${state.people.map(p=>`<button class="person-row" data-edit-person="${esc(p.id)}"><span class="avatar">${esc(initials(p.name))}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.email||'No email added')}</small></span><span class="person-groups">${state.groups.filter(g=>g.members.includes(p.name)).map(g=>esc(g.name)).join(' · ')||'No group assigned'}</span><span class="badge">${esc(p.role)} profile</span><span>↗</span></button>`).join('')}</div>`;}
function bindDirectory(){$('#manage-spaces')?.addEventListener('click',()=>{page='groups';render();});for(const id of ['focus-new-group','tile-new-group'])$('#'+id)?.addEventListener('click',()=>groupEditor());$('#directory-add-person')?.addEventListener('click',()=>personEditor());document.querySelectorAll('[data-edit-group]').forEach(b=>b.onclick=()=>groupEditor(b.dataset.editGroup));document.querySelectorAll('[data-edit-person]').forEach(b=>b.onclick=()=>personEditor(b.dataset.editPerson));}
function groupEditor(id){if(cloud.workspace&&cloud.role==='member')return toast('Only workspace owners and admins can edit groups.');const g=state.groups.find(g=>g.id===id)||{name:'',description:'',members:[],color:'#ff5938',icon:'↗'};openDialog(id?'Edit group':'Create your group',`<form id="group-form" class="form-grid"><label class="field full">Group name<input name="name" required maxlength="60" value="${esc(g.name)}" placeholder="e.g. Ocean exports, Pricing, Dispatch"></label><label class="field full">What does this group handle?<textarea name="description" maxlength="300" placeholder="Give this space a clear purpose.">${esc(g.description)}</textarea></label><label class="field">Accent color<input name="color" type="color" value="${groupColor(g)}"></label><label class="field">Icon<select name="icon">${options(['↗','▦','◈','◎','✦','◇','↔','▤'],g.icon||'↗')}</select></label><div class="full"><h3>Assign people</h3><p class="muted">Choose who belongs to this group.</p>${state.people.map(p=>`<label class="check-row"><input type="checkbox" name="members" value="${esc(p.name)}" ${g.members.includes(p.name)?'checked':''}>${esc(p.name)} <small class="muted">${esc(p.email)}</small></label>`).join('')}</div></form>`,`${id?'<button id="delete-group" class="danger">Delete group</button>':''}<button data-group-cancel>Cancel</button><button form="group-form" type="submit" class="primary">${id?'Save group':'Create group'}</button>`);$('#delete-group')?.addEventListener('click',()=>deleteGroupDialog(id));$('[data-group-cancel]').onclick=()=>$('#detail').close();$('#group-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=f.get('name').trim();if(!name||name.toLowerCase()==='all teams')return toast('Choose a group name other than All teams.');if(state.groups.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))return toast('A group with that name already exists.');const data={name,description:f.get('description').trim(),members:f.getAll('members'),color:f.get('color'),icon:f.get('icon')};if(id){const old=g.name;state.tasks.filter(t=>t.team===old).forEach(t=>t.team=name);if(team===old)team=name;Object.assign(g,data);}else state.groups.push({...data,id:uid()});syncDirectory();save();$('#detail').close();render();toast(id?'Group updated':'Group created — ready for assignment');};}
function personEditor(id){if(cloud.workspace&&cloud.role==='member')return toast('Only workspace owners and admins can edit profiles.');const p=state.people.find(p=>p.id===id)||{name:'',email:'',role:'Member'};openDialog(id?'Edit person':'Add a person',`<div class="notice">Create an assignment profile. To allow sign-in, use Account → Workspace access with the same email.</div><form id="person-form" class="form-grid" style="margin-top:20px"><label class="field full">Full name<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="Name used on assignments"></label><label class="field">Email<input name="email" type="email" value="${esc(p.email)}" placeholder="name@company.com"></label><label class="field">Profile role<select name="role">${options(['Member','Admin'],p.role)}</select></label><div class="full"><h3>Groups</h3>${state.groups.map(g=>`<label class="check-row"><input type="checkbox" name="groups" value="${esc(g.id)}" ${g.members.includes(p.name)?'checked':''}>${esc(g.name)}</label>`).join('')}</div></form>`,`<button data-person-cancel>Cancel</button><button form="person-form" type="submit" class="primary">Save person</button>`);$('[data-person-cancel]').onclick=()=>$('#detail').close();$('#person-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=f.get('name').trim(),email=f.get('email').trim();if(!name||['unassigned','all owners'].includes(name.toLowerCase()))return toast('Choose a valid person name.');if(state.people.some(x=>x.id!==id&&(x.name.toLowerCase()===name.toLowerCase()||(email&&x.email.toLowerCase()===email.toLowerCase()))))return toast('That name or email already exists.');const old=p.name;if(id){state.tasks.filter(t=>t.owner===old).forEach(t=>t.owner=name);if(owner===old)owner=name;Object.assign(p,{name,email,role:f.get('role')});}else state.people.push({id:uid(),name,email,role:f.get('role')});const selected=f.getAll('groups');for(const g of state.groups){g.members=g.members.filter(n=>n!==old&&n!==name);if(selected.includes(g.id))g.members.push(name);}syncDirectory();save();$('#detail').close();render();toast('Person saved — available for task assignment');};}

const transportTemplates = {
 'Air Import': ['Review pre-alert, AWB and commercial documents', 'Confirm flight arrival and cargo availability', 'Verify carrier and customs release', 'Arrange airport pickup and delivery', 'Record delivery confirmation'],
 'Air Export': ['Confirm airline booking and cargo cutoff', 'Verify pieces, weight, dimensions and shipping documents', 'Confirm applicable screening and export filing', 'Tender cargo and confirm airline acceptance', 'Verify departure and send pre-alert'],
 'Ocean Import': ['Review bill of lading, pre-alert and release instructions', 'Confirm arrival, availability and last free day', 'Verify customs, carrier and terminal releases', 'Arrange pickup and delivery', 'Confirm empty return when applicable'],
 'Ocean Export': ['Book space and confirm documentation and terminal cutoffs', 'Coordinate equipment pickup and loading', 'Confirm shipping instructions, applicable export filing and VGM', 'Verify terminal gate-in before cutoff', 'Confirm sailing and send final documents'],
 'Drayage': ['Confirm container, terminal and last free day', 'Verify releases and equipment needs', 'Book terminal and delivery appointments', 'Dispatch driver and track pickup and delivery', 'Confirm empty return and record interchange receipt'],
};
const workflowTemplates = {
 ...transportTemplates,
 'Pickup': ['Create pickup in the operations system', 'Send pickup details to the customer', 'Confirm carrier and appointment', 'Provide pickup documents', 'Confirm pickup completed', 'Confirm arrival and record proof of delivery'],
 'Import': ['Review pre-alert and shipping documents', 'Track arrival and confirm availability', 'Coordinate customs release', 'Arrange cargo pickup or delivery', 'Confirm delivery and close file'],
 'Export': ['Confirm booking and cutoffs', 'Collect cargo and export documents', 'Confirm applicable export filings', 'Deliver cargo to carrier', 'Confirm departure and send pre-alert'],
 'Arrival notice': ['Confirm arrival and availability with carrier', 'Verify shipment references and relevant deadlines', 'Prepare and send arrival notice', 'Record notice and follow up'],
 'Customs clearance': ['Collect commercial and transport documents', 'Send documents to broker', 'Follow up on holds or missing information', 'Verify release before authorizing movement']
};
const ftzTemplates = {
 'FTZ · Admission (214)': ['Review pre-alert and match invoice, packing list, and transport references', 'Confirm admission route, zone status, and applicable in-bond details', 'Coordinate receiving and reconcile tally against documents', 'Prepare and track the 214 admission', 'Record admission confirmation and reconcile zone lot or UIN'],
 'FTZ · Inbound zone transfer': ['Request origin zone history and inventory references', 'Confirm in-bond details and coordinate delivery', 'Reconcile received quantities and zone status', 'Track destination admission and record zone inventory references'],
 'FTZ · Manipulation (216)': ['Confirm requested work, quantities, and affected zone lots', 'Verify applicable authorization before scheduling work', 'Give warehouse the approved work instructions', 'Reconcile quantities before and after work and log supporting records'],
 'FTZ · Withdrawal / transfer': ['Confirm destination, movement type, and requested date', 'Verify zone status, inventory references, and release instructions', 'Track applicable entry or in-bond documents and authorization', 'Coordinate pick, tally-out, and handoff', 'Record proof of movement and reconcile zone inventory'],
 'FTZ · Manifest discrepancy': ['Record declared and actual quantities with receipt evidence', 'Confirm where the discrepancy originated and contact the carrier or broker', 'Prepare discrepancy documentation and track follow-up', 'Record resolution and reconcile affected records'],
 'FTZ · Inventory reconciliation': ['Identify zone lots or UINs and pull inventory records', 'Compare physical counts with recorded quantities', 'Investigate variances and document supporting records', 'Track resolution and review the final reconciliation'],
};
function ftzTemplateStorageKey(){
 return ['inboxy.ftz-templates.v1',cloud.workspace?.id||'demo',cloud.user?.id||'local'].join('.');
}
function ftzOverrides(){
 try {return JSON.parse(localStorage.getItem(ftzTemplateStorageKey()))||{};}
 catch {return {};}
}
function visibleTemplates(){
 return {...workflowTemplates,...ftzTemplates,...ftzOverrides()};
}
function editFtzTemplates(template=Object.keys(ftzTemplates)[0]){
 const overrides=ftzOverrides();
 const templates={...workflowTemplates,...ftzTemplates,...overrides};
 const exists=Object.hasOwn(templates,template);
 const preset=Object.hasOwn(ftzTemplates,template)||Object.hasOwn(workflowTemplates,template);
 openDialog('Customize task templates',`<p class="muted">Saved for you in this browser. Checklist changes apply to new tasks.</p>
  <form id="ftz-template-form" class="form-grid">
   <label class="field full">Template<select name="template"><option value="">＋ New template</option>${options(Object.keys(templates),template)}</select></label>
   ${exists?'':'<label class="field full">Template name<input name="name" required maxlength="60" placeholder="e.g. Customer document follow-up"></label><label class="field full">Category<select name="category"><option>Logistics</option><option>FTZ</option></select></label>'}
   <label class="field full">Checklist steps, one per line<textarea name="steps" rows="9" required maxlength="4000">${esc((templates[template]||[]).join('\n'))}</textarea></label>
  </form>`,
  `${preset&&Object.hasOwn(overrides,template)?'<button id="reset-ftz-template">Restore default</button>':''}
   ${exists&&!preset?'<button id="reset-ftz-template">Delete template</button>':''}
   <button class="primary" type="submit" form="ftz-template-form">Save template</button>`);
 const form=$('#ftz-template-form');
 form.elements.template.onchange=()=>editFtzTemplates(form.elements.template.value);
 const persist=(name,message)=>{
  try {localStorage.setItem(ftzTemplateStorageKey(),JSON.stringify(overrides));}
  catch {return toast('Template could not be saved in this browser.');}
  editFtzTemplates(name);toast(message);
 };
 $('#reset-ftz-template')?.addEventListener('click',()=>{
  delete overrides[template];
  persist(preset?template:undefined,preset?'Default checklist restored':'Template deleted');
 });
 form.onsubmit=event=>{
  event.preventDefault();
  const steps=form.elements.steps.value.split(/\r?\n/).map(step=>step.trim()).filter(Boolean);
  const rawName=exists?'':form.elements.name.value.trim();
  const name=exists?template:(form.elements.category.value==='FTZ'?'FTZ · ':'')+rawName;
  if(!exists&&(!rawName||Object.keys(templates).some(key=>key.toLowerCase()===name.toLowerCase())))return toast('Enter a unique template name.');
  if(!steps.length||steps.length>30||steps.some(step=>step.length>180))return toast('Enter 1–30 steps, with up to 180 characters per step.');
  overrides[name]=steps;
  persist(name,'Template saved');
 };
}
function isFtzTask(task){
 const record=task.parentId?state.tasks.find(parent=>parent.id===task.parentId):task;
 return Boolean(task.ftzReference||record?.ftzReference||record?.workflow?.startsWith('FTZ · '));
}
function workflowPicker(compact=false) {
 const names=Object.keys(visibleTemplates());
 const groups=[
  ['Air, ocean & drayage',names.filter(name=>Object.hasOwn(transportTemplates,name))],
  ['Logistics & custom',names.filter(name=>!Object.hasOwn(transportTemplates,name)&&!name.startsWith('FTZ · '))],
  ['Foreign-Trade Zone',names.filter(name=>name.startsWith('FTZ · '))]
 ];
 return `<label class="field full">Workflow template<select name="workflow"><option value="">${compact?'Template':'General task'}</option>${groups.map(([label,items])=>`<optgroup label="${label}">${options(items,'')}</optgroup>`).join('')}</select></label><details class="quick-more template-preview" data-workflow-steps hidden></details>`;
}
function bindWorkflow(form) {
 const picker = form.elements.workflow;
 if (!picker) return;
 picker.onchange = () => {
  const templates=visibleTemplates();
  const steps=Object.hasOwn(templates,picker.value)?templates[picker.value]:[];
  const preview = form.querySelector('[data-workflow-steps]');
  preview.hidden = !steps.length;
  preview.open=false;
  preview.innerHTML = `<summary>Preview checklist · ${steps.length} steps</summary>`+steps.map(step=>`<label class="check-row"><input type="checkbox" name="workflowStep" value="${esc(step)}" checked> ${esc(step)}</label>`).join('');
 };
}
function addWorkflowSteps(parent, steps) {
 for (const [stepOrder,title] of steps.entries()) {
  state.tasks.push({...newTaskRecord({title, parentId:parent.id, shipmentId:parent.shipmentId, team:parent.team, owner:parent.owner}),stepOrder});
 }
}
function newTaskRecord(data){return {id:uid(),title:data.title.trim(),clientId:data.clientId||'',taskType:data.taskType||'',cutoff:data.cutoff||'',consequence:data.consequence||'',customer:data.customer?.trim()||'',ourReference:data.ourReference?.trim()||'',customerReference:data.customerReference?.trim()||'',workflow:data.workflow||'',ftzReference:data.ftzReference?.trim()||'',team:data.team|| (team==='All teams'?TEAMS[0]:team),owner:data.owner||'Unassigned',status:data.status||'Up next',priority:data.priority||'Normal',due:data.due||'',followUp:data.followUp||'',nextAction:data.nextAction||'',description:data.description||'',shipmentId:data.shipmentId||'',parentId:data.parentId||null,dependencies:[],notes:[],activity:[{text:'Task created',date:new Date().toISOString()}],public:false,publicTitle:'',impact:false,boardOrder:state.tasks.filter(t=>t.status===(data.status||'Up next')).length};}
function composerHTML(email){
 return `<form id="inline-capture" class="inline-capture" data-context="${esc(email?.id||'workspace')}">
  <div class="capture-row">
   <input name="title" aria-label="New task title" maxlength="180" required placeholder="What needs to happen?" value="${esc((mailActionDraft?.title||email?.subject||'').slice(0,180))}">
   ${workflowPicker(true)}
   <button class="primary" type="submit">Add task</button>
  </div>
  ${email&&mailActionDraft?composerSuggestions(mailActionDraft):''}
  ${!email&&captureStatus!=='Up next'?`<small class="capture-destination">Adding to ${esc(captureStatus)}</small>`:''}
 </form>`;
}
function focusComposer(status='Up next'){
 if(page!=='workspace'||status!==captureStatus){
  page='workspace';captureStatus=status;render();
 }
 $('#inline-capture input')?.focus();
}
function bindComposer(email){
 const form=$('#inline-capture');
 bindWorkflow(form);
 form.onsubmit=event=>{
  event.preventDefault();
  const data=new FormData(form),title=data.get('title').trim(),steps=data.getAll('workflowStep');
  if(!title)return;

  const status=email?'Up next':captureStatus;
  if(steps.length&&status==='Completed')return toast('Add checklist tasks to an active column.');
  const draft=email?mailActionDraft:null;
  const confirmed={};
  if(form.elements.applySuggestions?.checked)for(const element of form.querySelectorAll('[data-suggested-field]'))confirmed[element.dataset.suggestedField]=element.value;
  const task=newTaskRecord({title,workflow:data.get('workflow'),status,owner:scope==='My next actions'?(myOwner()||'Unassigned'):owner==='All owners'?'Unassigned':owner,shipmentId:operationFilter,taskType:typeFilter,...confirmed});
  if(email&&draft?.requestKey){
   if(state.tasks.some(item=>item.requestKey===draft.requestKey))return toast('This request already has a task.');
   task.requestKey=draft.requestKey;
  }
  state.tasks.push(task);addWorkflowSteps(task,steps);
  if(email){addMailLink(email,task.id);captureEmailId='';mailActionDraft=null;}
  else captureStatus='Up next';
  form.reset();form.elements.workflow.onchange();
  save();render();
  if(email)taskDetail(task.id);
  else $('#inline-capture input')?.focus();
  toast('Task added');
 };
}
function taskProperties(task){
 const field=(key,label,value,{choices,type='text',display=value,style='',limit=180}={})=>{
  const control=choices?`<select name="${key}">${choices}</select>`:type==='textarea'?
   `<textarea name="${key}" rows="3" maxlength="4000">${esc(value)}</textarea>`:
   `<input name="${key}" type="${type}" maxlength="${limit}" value="${esc(value)}">`;
  return `<div class="task-value ${style}"><button type="button" data-property="${key}" aria-expanded="false" aria-label="Edit ${label}">
   <small>${label}</small><strong>${esc(display||'Add '+label.toLowerCase())}</strong><span aria-hidden="true">✎</span>
  </button><label class="field" data-task-field hidden>${label}${control}</label></div>`;
 };
 const section=(key,title,body)=>`<details class="quick-more task-section" data-task-section="${key}"><summary>${esc(title)}</summary>${body}</details>`;
 const due=task.due||'';
 const context=[taskCustomer(task),...new Set(taskReferences(task))].filter(Boolean).join(' · ');
 return `<div id="inline-properties" class="task-summary">
  ${field('title','Task title',task.title,{style:'task-title-value'})}
  <p class="muted task-reference-line" ${context?'':'hidden'}>${esc(context)}</p>
  ${field('nextAction','Next action',task.nextAction,{display:nextAction(task),style:'task-next-value'})}
  <div class="task-summary-pair">
   ${field('status','Status',task.status,{choices:options(STATUSES,task.status)})}
   ${field('owner','Owner',task.owner,{choices:options(USERS,task.owner)})}
  </div>
  ${task.status==='Waiting'?field('waitingOn','Waiting on',task.waitingOn):''}
  ${section('schedule',task.cutoff?'Schedule · Cutoff '+fmt(task.cutoff):due?'Schedule · Due '+fmt(due):'Schedule',[
   field('due','Requested by',due,{type:dateOnly(due)?'date':'datetime-local',display:due&&fmt(due)}),
   field('cutoff','Hard cutoff',task.cutoff,{type:'datetime-local',display:task.cutoff&&fmt(task.cutoff)}),
   field('followUp','Follow-up reminder',task.followUp,{type:'datetime-local',display:task.followUp&&fmt(task.followUp)})
  ].join(''))}
  ${section('details','Task details',[
   field('team','Department',task.team,{choices:options(TEAMS,task.team)}),
   field('taskType','Type',task.taskType,{choices:options(['',...state.taskTypes],task.taskType||'')}),
   field('priority','Priority',task.priority,{display:task.priority+(task.priorityOverride?' · Manual':''),choices:options(priorities,task.priority)}),
   field('description','Instructions',task.description,{type:'textarea'}),
   field('consequence','Consequence',task.consequence),
   field('clientId','Client',task.clientId,{display:state.clients.find(c=>c.id===task.clientId)?.name,choices:clientOptions(task.clientId)}),
   field('shipmentId','Operation',task.shipmentId,{display:shipment(task.shipmentId)?.reference,choices:operationOptions(task.shipmentId)}),
   field('customer','Customer name',task.customer,{display:taskCustomer(task)}),
   field('ourReference','Internal reference',task.ourReference),
   field('customerReference','Customer reference',task.customerReference),
   field('ftzReference','FTZ reference',task.ftzReference)
  ].join(''))}
 </div>`;
}
function applyBoardMove(id,status,beforeId=null){const t=state.tasks.find(t=>t.id===id);if(!t)return;const old=t.status;const issue=moveTask(state.tasks,id,status,beforeId);if(issue){toast(issue);render();return;}activity(t,old===status?'Reordered on board':`Moved from ${old} to ${status}`);save();render();toast(old===status?'Card reordered':`Moved to ${status}`);}
let dragId=null,dragGhost=null,dragStart=null,dragLast=null,dragFrame=null;
function dropTarget(x,y){const el=document.elementFromPoint(x,y);const col=el?.closest('[data-status]');if(!col)return null;const cards=[...col.querySelectorAll('.operation-card')].filter(c=>c.dataset.task!==dragId);const before=cards.find(c=>y<c.getBoundingClientRect().top+c.getBoundingClientRect().height/2);return {col,status:col.dataset.status,beforeId:before?.dataset.task||null};}
function clearDrag(){dragId=null;dragGhost?.remove();dragGhost=null;dragStart=null;dragLast=null;cancelAnimationFrame(dragFrame);dragFrame=null;document.body.classList.remove('is-dragging');document.querySelectorAll('.drop-over,.drag-source,.drop-before,.drop-at-end').forEach(e=>e.classList.remove('drop-over','drag-source','drop-before','drop-at-end'));}
function bindBoard(){
 document.querySelectorAll('[data-add-status]').forEach(b=>b.onclick=()=>focusComposer(b.dataset.addStatus));
 document.querySelectorAll('[data-quick-status]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const title=new FormData(f).get('title').trim();if(!title)return;const status=f.dataset.quickStatus;state.tasks.push(newTaskRecord({title,status,shipmentId:operationFilter,owner:owner==='All owners'?'Unassigned':owner}));save();render();const input=[...document.querySelectorAll('[data-quick-status]')].find(x=>x.dataset.quickStatus===status)?.querySelector('input');input?.focus();toast('Task created — click NEXT to add the next action');});
 document.querySelectorAll('[data-quick-edit]').forEach(b=>b.onclick=()=>taskDetail(b.dataset.quickEdit,b.dataset.field));
 document.querySelectorAll('[data-card-email]').forEach(b=>b.onclick=()=>taskDetail(b.dataset.cardEmail));
 document.querySelectorAll('[data-move]').forEach(s=>s.onchange=()=>applyBoardMove(s.dataset.move,s.value));
 document.querySelectorAll('.operation-card').forEach(c=>{c.ondragstart=e=>{if(e.target.closest('select,input,button')){e.preventDefault();return;}dragId=c.dataset.task;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';c.classList.add('drag-source');};c.ondragend=clearDrag;});
 document.querySelectorAll('[data-status]').forEach(col=>{col.ondragover=e=>{if(!dragId)return;e.preventDefault();e.dataTransfer.dropEffect='move';paintDrop(dropTarget(e.clientX,e.clientY));};col.ondragleave=e=>{if(!col.contains(e.relatedTarget))paintDrop(null);};col.ondrop=e=>{if(!dragId)return;e.preventDefault();const id=dragId,target=dropTarget(e.clientX,e.clientY);clearDrag();if(target)applyBoardMove(id,target.status,target.beforeId);};});
 document.querySelectorAll('[data-drag]').forEach(handle=>{handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();clearDrag();dragId=handle.dataset.drag;dragStart={x:e.clientX,y:e.clientY};dragLast={x:e.clientX,y:e.clientY};handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(dragId!==handle.dataset.drag||!dragStart)return;e.preventDefault();dragLast={x:e.clientX,y:e.clientY};if(!dragGhost&&Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y)>5){const card=handle.closest('.operation-card');dragGhost=card.cloneNode(true);dragGhost.removeAttribute('data-task');dragGhost.setAttribute('aria-hidden','true');dragGhost.classList.add('drag-ghost');dragGhost.style.width=card.getBoundingClientRect().width+'px';document.body.append(dragGhost);card.classList.add('drag-source');document.body.classList.add('is-dragging');const tick=()=>{if(!dragGhost||!dragLast)return;const board=$('.board'),r=board.getBoundingClientRect();if(dragLast.x>r.right-65)board.scrollLeft+=12;else if(dragLast.x<r.left+65)board.scrollLeft-=12;if(dragLast.y>innerHeight-70)window.scrollBy(0,10);else if(dragLast.y<70)window.scrollBy(0,-10);paintDrop(dropTarget(dragLast.x,dragLast.y));dragFrame=requestAnimationFrame(tick);};dragFrame=requestAnimationFrame(tick);}if(dragGhost){dragGhost.style.left=(e.clientX-40)+'px';dragGhost.style.top=(e.clientY-25)+'px';paintDrop(dropTarget(e.clientX,e.clientY));}};handle.onpointerup=e=>{if(dragId!==handle.dataset.drag)return;const id=dragId,target=dragGhost?dropTarget(e.clientX,e.clientY):null;clearDrag();if(target)applyBoardMove(id,target.status,target.beforeId);};handle.onpointercancel=clearDrag;handle.onclick=e=>e.stopPropagation();});
}

function paintDrop(target){
 document.querySelectorAll('.drop-over,.drop-before,.drop-at-end').forEach(el=>el.classList.remove('drop-over','drop-before','drop-at-end'));
 if(!target)return;
 target.col.classList.add('drop-over');
 const before=[...target.col.querySelectorAll('.operation-card')].find(c=>c.dataset.task===target.beforeId);
 if(before)before.classList.add('drop-before');
 else target.col.querySelector('.column-cards').classList.add('drop-at-end');
}

function loadCloudState(snapshot){const params=new URL(location.href).searchParams,result=params.get('mail');if(result){page='settings';history.replaceState(null,'',location.pathname);if(result==='complete'){const args={provider:params.get('mail_provider'),code:params.get('mail_code'),state:params.get('mail_state')};setTimeout(()=>mailAction('complete',args).then(()=>{mailboxStatusCache=null;renderMailPanel();openDialog('Mailbox connected','<p>Choose Sync inbox next to your connected account to import recent messages into this shared workspace.</p>','<button id="mail-show-account" class="primary">View connected accounts</button>');$('#mail-show-account').onclick=()=>$('#detail').close();}).catch(e=>openDialog('Mailbox connection did not finish',`<p>${esc(e.message)}</p><p>The mailbox was not connected. Share this error text so we can identify the cause.</p>`)),0);}else setTimeout(()=>toast(result==='cancelled'?'Mailbox connection cancelled.':'Mailbox connection failed. Check the provider setup and try again.'),100);}
 appReady=true;state=migrateWorkspace(snapshot);syncDirectory();if(!state.emails.some(email=>email.id===selectedEmail))selectedEmail=state.emails[0]?.id;render();
}
function cloudSaveError(error){
 openDialog('Your changes need attention',`<p>${esc(error.message)}</p><p>Keep this tab open. Download your unsaved work before reloading. The server copy has not been overwritten.</p>`,`<button id="save-recovery">Download unsaved work</button><button id="reload-cloud">Reload server copy</button>`);
 $('#save-recovery').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download='inboxy-unsaved-work.json';a.click();URL.revokeObjectURL(a.href);};
 $('#reload-cloud').onclick=()=>{cloud.failed=false;location.reload();};
}
function accountDialog(){
 openDialog('Your connected workspace',`<p><strong>${esc(cloud.workspace.name)}</strong></p><p>${esc(cloud.user.email)} · ${esc(cloud.role)}</p><p data-cloud-status>${cloud.pending?'Saving…':cloud.failed?'Changes not saved':'Saved to Supabase'}</p><div id="workspace-access"></div>`,`<button id="switch-workspace">Switch workspace</button><button id="logout">Sign out</button>`);
 $('#logout').onclick=logout;$('#switch-workspace').onclick=()=>{if(cloud.pending||cloud.failed)return toast('Save or export your changes first.');localStorage.removeItem('inboxy.selectedWorkspace');location.reload();};
 if(['owner','admin'].includes(cloud.role))accessPanel($('#workspace-access'),addTeamAssignee).catch(e=>toast(e.message));
}
function addTeamAssignee({name,email,role}){
 if(!name||state.people.some(person=>person.email?.toLowerCase()===email))return;
 if(state.people.some(person=>person.name.toLowerCase()===name.toLowerCase())||['all owners','unassigned'].includes(name.toLowerCase())){
  return toast('Access was granted. Choose a different assignee name under Team.');
 }
 state.people.push({id:uid(),name,email,role:role==='admin'?'Admin':'Member'});
 syncDirectory();save();render();toast('Workspace access granted and assignee added');
}
setInterval(()=>refreshCloud(loadCloudState),15000);
window.addEventListener('focus',()=>refreshCloud(loadCloudState));

function groupColor(g){return /^#[0-9a-f]{6}$/i.test(g.color||'')?g.color:'#ff5938';}
function deleteGroupDialog(id){
 const g=state.groups.find(g=>g.id===id),count=state.tasks.filter(t=>t.team===g.name).length,others=state.groups.filter(g=>g.id!==id);
 openDialog('Delete '+esc(g.name),`<p>${count?`${count} task${count===1?'':'s'}, including completed work, will move to the group you choose. Owners, notes, linked emails and dependencies stay with the tasks.`:'This group has no tasks. People remain in the workspace.'}</p>${!others.length?'<div class="notice">Create a replacement group before deleting your last group.</div>':`<form id="delete-group-form">${count?`<label class="field">Move tasks to<select name="target">${others.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>`:''}</form>`}`,`<button id="cancel-delete-group">Cancel</button>${others.length?'<button class="danger" form="delete-group-form" type="submit">Delete group</button>':''}`);
 $('#cancel-delete-group').onclick=()=>groupEditor(id);
 $('#delete-group-form')?.addEventListener('submit',e=>{e.preventDefault();try{const result=removeGroup(state,id,new FormData(e.target).get('target'));if(team===g.name)team=result.target||'All teams';syncDirectory();save();$('#detail').close();render();toast(result.moved?`Group deleted. ${result.moved} tasks moved to ${result.target}.`:'Group deleted.');}catch(err){toast(err.message);}});
}

const mailboxCursors=new Map();
let mailboxStatusCache;
async function showInboxSync(){
 const label=$('#inbox-sync-state'),button=$('#inbox-sync');
 if(!label||!button)return;
 if(!cloud.workspace){button.disabled=true;return;}
 button.disabled=true;
 label.textContent='Checking mailboxes…';
 try{
  if(!mailboxStatusCache||mailboxStatusCache.expires<Date.now()){
   mailboxStatusCache={expires:Date.now()+20000,promise:mailAction('status')};
  }
  const result=await mailboxStatusCache.promise;
  if(!button.isConnected)return;
  const accounts=result.connections.filter(c=>c.user_id===cloud.user.id);
  const last=accounts.map(c=>c.last_sync).filter(Boolean).sort().at(-1);
  label.textContent=last?'Last sync '+fmt(last):accounts.length?'Ready to sync':'Connect your mailbox';
  button.disabled=false;
  button.onclick=()=>{
   if(!accounts.length){page='settings';render();return;}
   if(accounts.length===1)return syncMailbox(accounts[0].id);
   openDialog('Sync mailbox',`<div class="actions">${accounts.map(account=>`<button data-sync-choice="${esc(account.id)}">${esc(account.email)}</button>`).join('')}</div>`);
   document.querySelectorAll('[data-sync-choice]').forEach(choice=>choice.onclick=()=>syncMailbox(choice.dataset.syncChoice));
  };
  const older=accounts.filter(account=>mailboxCursors.get(account.id));
  if(older.length===1){
   const more=document.createElement('button');more.className='small';more.textContent='Load older';
   more.onclick=()=>syncMailbox(older[0].id,true);label.after(more);
  }
 }catch(error){mailboxStatusCache=null;if(label.isConnected)label.textContent=error.message;}
}
async function renderMailPanel(){
 const target=$('#mail-integrations');if(!target)return;
 if(!cloud.workspace){target.innerHTML='<p>Sign in to connect Gmail or Microsoft 365/Outlook and import messages into a shared workspace.</p><button id="mail-signin">Sign in →</button>';$('#mail-signin').onclick=()=>location.reload();return;}
 target.innerHTML='<p class="muted">Checking your mailbox connections…</p>';
 try{const result=await mailAction('status');if(!target.isConnected)return;
 target.innerHTML=`<p class="muted">Import inbox messages, create tasks and reply from the original conversation. Imported messages are visible to everyone in this workspace. Attachments and background sync are not included yet.</p><div class="mail-connections">${Object.entries(result.providers).map(([key,p])=>`<section class="mail-provider"><span class="eyebrow">${key==='gmail'?'GOOGLE':'MICROSOFT'}</span><h3>${esc(p.label)}</h3><span class="badge">${p.configured?'Ready to connect':'Provider setup needed'}</span>${result.connections.filter(c=>c.provider===key).map(c=>`<div class="mail-account"><strong>${esc(c.email)}</strong><small>${c.user_id===cloud.user.id?'Your mailbox':'Connected by a teammate'} · ${c.last_sync?'Last sync '+esc(fmt(c.last_sync)):'Not synced yet'}</small><div class="actions">${c.user_id===cloud.user.id?`<button data-mail-sync="${c.id}">Sync inbox</button>${mailboxCursors.get(c.id)?`<button data-mail-older="${c.id}">Load older</button>`:''}`:''}${c.user_id===cloud.user.id||['owner','admin'].includes(cloud.role)?`<button data-mail-disconnect="${c.id}">Disconnect</button>`:''}</div></div>`).join('')}<div class="actions" style="margin-top:18px"><button data-mail-connect="${key}" ${p.configured?'':'disabled'}>＋ Connect account</button><button data-mail-setup="${key}">Setup guide</button></div></section>`).join('')}</div><p id="mail-feedback" class="mail-feedback" role="status"></p>`;
 target.querySelectorAll('[data-mail-connect]').forEach(b=>b.onclick=()=>connectMailbox(b.dataset.mailConnect));
 target.querySelectorAll('[data-mail-setup]').forEach(b=>b.onclick=()=>mailSetup(b.dataset.mailSetup,result.providers[b.dataset.mailSetup]));
 target.querySelectorAll('[data-mail-sync]').forEach(b=>b.onclick=()=>syncMailbox(b.dataset.mailSync));
 target.querySelectorAll('[data-mail-older]').forEach(b=>b.onclick=()=>syncMailbox(b.dataset.mailOlder,true));
 target.querySelectorAll('[data-mail-disconnect]').forEach(b=>b.onclick=()=>disconnectMailbox(b.dataset.mailDisconnect));
 }catch(e){target.textContent='Could not load email connections: '+e.message;}
}
function mailSetup(provider,p){
 const google=provider==='gmail';
 openDialog(p.label+' setup',`<p>Register Inboxy with ${google?'Google Cloud':'Microsoft Entra'} once. Every user can then connect their own mailbox.</p><ol class="mail-setup"><li>Open <a href="${google?'https://console.cloud.google.com/apis/credentials':'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'}" target="_blank" rel="noopener">${google?'Google Cloud credentials':'Microsoft app registrations'}</a> and create an OAuth ${google?'Web application':'Web application (not SPA)'}.</li><li>${google?'Enable the Gmail API and configure the OAuth consent screen. Add your users as test users while the app is in testing. Request Gmail read and send permissions.':'Allow work/school and personal accounts if needed. Add delegated User.Read, Mail.Read, Mail.Send and offline_access permissions. Your organization may require admin consent.'}</li><li>Register this exact redirect URI:<br><code>${esc(p.callback)}</code></li><li>In <a href="https://supabase.com/dashboard/project/hifqekelvzgquuputfzd/functions/secrets" target="_blank" rel="noopener">Supabase Edge Function secrets</a>, save:<br><code>${esc(p.clientIdSecret)}</code> = application client ID<br><code>${esc(p.clientSecretSecret)}</code> = client secret value.</li><li>Return to Connections & data and open this page again. Connect your mailbox and approve access.</li></ol><p>OAuth tokens are encrypted in Supabase Vault. Never put the client secret in GitHub or a workspace backup.</p>`);
}
function connectMailbox(provider){
 openDialog('Connect your mailbox',`<p>Inboxy will request permission to read emails and send replies from the mailbox you choose.</p><p><strong>Messages you import are shared with everyone in ${esc(cloud.workspace.name)}.</strong> Connect an operational mailbox appropriate for this team.</p><p>You choose when to sync. Inboxy will not turn every email into a task or send replies automatically.</p>`,`<button id="mail-cancel">Cancel</button><button id="mail-authorize" class="primary">Continue to ${provider==='gmail'?'Google':'Microsoft'}</button>`);
 $('#mail-cancel').onclick=()=>$('#detail').close();$('#mail-authorize').onclick=async e=>{e.target.disabled=true;try{if(cloud.pending||cloud.failed)throw Error('Finish saving or export unsaved changes before connecting a mailbox.');const result=await mailAction('start',{provider});location.assign(result.url);}catch(err){toast(err.message);e.target.disabled=false;}};
}
async function syncMailbox(connection,older=false){
 if(cloud.pending||cloud.failed)return toast('Finish saving or export unsaved changes before syncing.');
 const root=$('#app');root.inert=true;openDialog('Syncing inbox','<p>Importing a batch of messages. Your existing task links are preserved.</p>');
 try{const result=await mailAction('sync',{connection,...(older?{cursor:mailboxCursors.get(connection)}:{})});mailboxCursors.set(connection,result.nextCursor);mailboxStatusCache=null;$('#detail').close();page='inbox';await refreshCloud(loadCloudState);render();toast(`${result.processed} messages refreshed.${result.nextCursor?' Load older is available in Connections & data.':''}`);}catch(e){$('#detail').close();toast(e.message);}finally{root.inert=false;}
}
function disconnectMailbox(connection){
 openDialog('Disconnect mailbox','<p>Stop Inboxy from syncing or sending through this account. Previously imported messages and task references stay in this workspace. You can also revoke Inboxy in your email provider’s account settings.</p>','<button id="mail-keep">Cancel</button><button class="danger" id="mail-remove">Disconnect</button>');
 $('#mail-keep').onclick=()=>$('#detail').close();$('#mail-remove').onclick=async e=>{e.target.disabled=true;try{await mailAction('disconnect',{connection});mailboxCursors.delete(connection);mailboxStatusCache=null;$('#detail').close();renderMailPanel();toast('Mailbox disconnected');}catch(err){toast(err.message);e.target.disabled=false;}};
}
async function connectedReply(email,draft){
 const recipient=email.replyTo?.match(/<([^>]+)>/)?.[1]||email.replyTo||email.from.match(/<([^>]+)>/)?.[1]||email.from;
 openDialog('Reply by email',`<p class="notice">This will send a real email from the connected mailbox. Review the recipient and message before sending.</p><form id="connected-reply" class="form-grid"><label class="field full">To<input name="to" type="email" required value="${esc(draft?.to||recipient)}"></label><label class="field full">Subject<input name="subject" required value="${esc(draft?.subject||(/^re:/i.test(email.subject)?email.subject:'Re: '+email.subject))}"></label><label class="field full">Message<textarea name="body" required maxlength="50000" style="min-height:180px">${esc(draft?.body)}</textarea></label></form>`,'<button id="keep-reply-draft">Save draft</button><button class="primary" type="submit" form="connected-reply">Send reply</button>');
 $('#keep-reply-draft').onclick=()=>{const f=Object.fromEntries(new FormData($('#connected-reply')));if(draft)Object.assign(draft,f,{date:new Date().toISOString()});else state.drafts.unshift({...f,id:uid(),emailId:email.id,date:new Date().toISOString()});save();$('#detail').close();toast('Reply draft saved — not sent');};
 $('#connected-reply').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const buttons=$('#detail').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await mailAction('reply',{connection:email.connectionId,email:email.id,...f});if(draft){state.drafts=state.drafts.filter(d=>d.id!==draft.id);save();}$('#detail').close();render();toast('Reply sent');}catch(err){toast('Reply not confirmed: '+err.message+'. Check your Sent folder before trying again.');buttons.forEach(b=>b.disabled=false);}};
}

function myOwner(){
 return cloud.workspace?state.people.find(p=>p.email.toLowerCase()===cloud.user?.email?.toLowerCase())?.name:'Ignacio';
}
function clientOptions(id){
 return '<option value="">No linked client</option>'+state.clients.map(c=>`<option value="${esc(c.id)}" ${c.id===id?'selected':''}>${esc(c.name)}</option>`).join('');
}
function operationOptions(id){
 return '<option value="">Any / standalone</option>'+state.shipments.map(s=>`<option value="${esc(s.id)}" ${s.id===id?'selected':''}>${esc(s.reference)}</option>`).join('');
}
function planningBar(){
 const saved=personalState('saved-views');
 return `<div class="planning-bar actions">
  <select id="planning-scope" aria-label="Work scope">${options(['All tasks','My next actions','Team overview'],scope)}</select>
  <select id="planning-group" aria-label="Group tasks">${options(['None','By task type','By client','By shipment'],groupBy)}</select>
  <select id="type-filter" aria-label="Task type"><option value="">All types</option>${options(state.taskTypes,typeFilter)}</select>
  <select id="priority-filter" aria-label="Priority filter"><option value="">All priorities</option>${options(priorities,priorityFilter)}</select>
  <select id="operation-filter" aria-label="Operation">${operationOptions(operationFilter)}</select>
  <select id="saved-view" aria-label="Saved views"><option value="">Saved views</option>${options(Object.keys(saved),'')}</select>
  <button id="save-view">Save view</button>${Object.keys(saved).length?'<button id="manage-views">Manage views</button>':''}<button id="manage-types">Task types</button>
  <button id="manage-clients">Clients</button>
 </div>`;
}
function groupLabel(task){
 if(scope==='Team overview'){
  if(task.status==='Completed')return 'Completed';
  if(deadline(task)&&dueTime(deadline(task))<=Date.now()+86400000)return 'At risk / Due within 24h';
  if(task.owner==='Unassigned')return 'Unassigned';
  if(task.status==='Waiting')return 'Waiting';
  return task.status;
 }
 return {'By task type':task.taskType||'No type','By client':taskCustomer(task)||'No client',
  'By shipment':shipment(task.shipmentId)?.reference||'Standalone'}[groupBy]||'';
}
function taskTable(list){
 const done=state.tasks.filter(t=>t.status==='Completed').length;
 const counts=scope==='Team overview'?`<div class="notice">${done} completed · ${state.tasks.length-done} pending · ${state.tasks.filter(t=>t.status!=='Completed'&&blockedBy(t,state.tasks).length).length} blocked · ${state.tasks.filter(t=>t.status!=='Completed'&&workQueues.Overdue(t,Date.now())).length} overdue · ${state.tasks.filter(t=>t.status!=='Completed'&&workQueues['Due within 24h'](t,Date.now())&&!workQueues.Overdue(t,Date.now())).length} upcoming<br>${TEAMS.map(name=>esc(name)+' '+state.tasks.filter(t=>t.team===name&&t.status!=='Completed').length).join(' · ')}</div>`:'';
 const bulk=`<div class="actions selection-bar"><label><input type="checkbox" id="select-tasks" ${list.length&&list.every(t=>selectedTasks.has(t.id))?'checked':''}> Select visible</label><span>${list.filter(t=>selectedTasks.has(t.id)).length} selected</span><select id="bulk-owner" aria-label="Assign selected tasks"><option value="">Assign selected…</option>${options(USERS,'')}</select><select id="bulk-status" aria-label="Change selected status"><option value="">Move selected…</option>${options(STATUSES,'')}</select><button class="danger" id="bulk-delete">Delete selected</button></div>`;
 const groups=new Map();
 for(const task of list){const label=groupLabel(task);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(task);}
 return counts+bulk+([...groups].map(([label,tasks])=>`${label?`<h3 class="task-group-label">${esc(label)} <small>${tasks.length}</small></h3>`:''}<div class="table-wrap"><table><thead><tr><th></th><th>Task / next action</th><th>Client / reference</th><th>Department / owner</th><th>Status</th><th>Deadline</th><th>Priority / follow-up</th></tr></thead><tbody>${tasks.map(t=>`<tr tabindex="0" data-task="${esc(t.id)}">
  <td><input type="checkbox" data-select-task="${esc(t.id)}" aria-label="Select ${esc(t.title)}" ${selectedTasks.has(t.id)?'checked':''}></td>
  <td><strong>${esc(t.title)}</strong><p class="muted">${esc(nextAction(t)||t.taskType||'')}</p></td>
  <td>${esc(taskCustomer(t)||'—')}<br><small>${esc(taskReferences(t).join(' · '))}</small></td>
  <td>${esc(t.team)}<select data-row-field="owner" aria-label="Owner">${options(USERS,t.owner)}</select>
   ${t.owner==='Unassigned'&&myOwner()?'<button data-claim>Claim</button>':''}</td>
  <td><select data-row-field="status" aria-label="Status">${options(STATUSES,t.status)}</select>
  ${t.status==='Waiting'?`<input data-row-field="waitingOn" aria-label="Waiting on" placeholder="Waiting on…" value="${esc(t.waitingOn)}">`:''}</td>
  <td><button data-row-dates="${esc(t.id)}" data-date-kind="deadline">${esc(t.cutoff?'Cutoff · '+fmt(t.cutoff):t.due?fmt(t.due):'Set date')}</button></td>
  <td><select data-row-field="priority" aria-label="Priority">${options(priorities,t.priority)}</select><button data-row-dates="${esc(t.id)}" data-date-kind="followUp">${t.followUp?esc(fmt(t.followUp)):'Remind'}</button><small class="row-reason">${esc(priority(t,state.tasks).reasons.join(' · '))}</small></td>
 </tr>`).join('')}</tbody></table></div>`).join('')||'<div class="panel empty">No tasks match these filters.</div>');
}
function bindPlanning(){
 if(page!=='workspace')return;
 const change=(id,fn)=>$('#'+id)?.addEventListener('change',e=>{fn(e.target.value);selectedTasks.clear();render();});
 change('planning-scope',value=>{scope=value;view='List';});
 change('planning-group',value=>{groupBy=value;scope='All tasks';view='List';});
 change('type-filter',value=>typeFilter=value);
 change('priority-filter',value=>priorityFilter=value);
 change('operation-filter',value=>operationFilter=value);
 change('saved-view',value=>{
  const saved=personalState('saved-views')[value];
  if(!saved)return;
  ({view,scope,groupBy,team,owner,customerFilter,statusFilter,dueFilter,typeFilter,priorityFilter,operationFilter,workQueue,ftzOnly,query}=saved);
 });
 $('#save-view')?.addEventListener('click',()=>{
  const title=prompt('Name this view')?.trim();if(!title)return;
  setPersonalState('saved-views',{...personalState('saved-views'),[title]:{view,scope,groupBy,team,owner,customerFilter,statusFilter,dueFilter,typeFilter,priorityFilter,operationFilter,workQueue,ftzOnly,query}});render();
 });
 $('#manage-views')?.addEventListener('click',()=>{
  const saved=personalState('saved-views');
  openDialog('Saved views',Object.keys(saved).map(title=>`<div class="section-title"><span>${esc(title)}</span><button data-delete-view="${esc(title)}">Remove</button></div>`).join(''));
  document.querySelectorAll('[data-delete-view]').forEach(button=>button.onclick=()=>{
   delete saved[button.dataset.deleteView];setPersonalState('saved-views',saved);$('#detail').close();render();
  });
 });
 $('#manage-types')?.addEventListener('click',typeDirectory);
 $('#manage-clients')?.addEventListener('click',clientDirectory);
 const visible=()=>filtered().filter(t=>view!=='Do next'||t.status!=='Completed');
 const ids=()=>visible().filter(t=>selectedTasks.has(t.id)).map(t=>t.id);
 $('#select-tasks')?.addEventListener('change',e=>{visible().forEach(t=>e.target.checked?selectedTasks.add(t.id):selectedTasks.delete(t.id));render();});
 document.querySelectorAll('[data-select-task]').forEach(control=>control.onchange=()=>{control.checked?selectedTasks.add(control.dataset.selectTask):selectedTasks.delete(control.dataset.selectTask);render();});
 document.querySelectorAll('[data-row-field],[data-claim]').forEach(control=>{
  const task=state.tasks.find(t=>t.id===control.closest('[data-task]').dataset.task);
  if(control.hasAttribute('data-claim'))control.onclick=()=>editRows([task.id],'owner',myOwner());
  else control.onchange=()=>editRows([task.id],control.dataset.rowField,control.value);
 });
 document.querySelectorAll('[data-row-dates]').forEach(button=>button.onclick=()=>rowDates(button));
 $('#bulk-owner')?.addEventListener('change',e=>editRows(ids(),'owner',e.target.value));
 $('#bulk-status')?.addEventListener('change',e=>editRows(ids(),'status',e.target.value));
 $('#bulk-delete')?.addEventListener('click',()=>confirmTaskDeletion(ids()));
}
function editRows(ids,key,value){
 if(!ids.length){render();return toast('Select at least one task.');}
 if(!value&&key!=='waitingOn')return;
 const skipped=[];
 for(const id of ids){
  const task=state.tasks.find(t=>t.id===id);
  if(key==='status'){
   const issue=moveTask(state.tasks,id,value);
   if(issue){skipped.push(task.title+' · '+issue);continue;}
  }else task[key]=value.trim();
  if(key==='priority')task.priorityOverride=true;
  activity(task,'Updated '+(key==='waitingOn'?'waiting on':key));
 }
 save();render();
 if(skipped.length)toast(skipped.join(' / '));
}
function confirmTaskDeletion(ids){
 if(!ids.length)return toast('Select at least one task.');
 openDialog('Delete '+(ids.length===1?'task':ids.length+' tasks'),'<p>Subtasks become standalone actions and linked emails stay in the inbox. This deletes the selected tasks and their history.</p>','<button class="danger" id="confirm-delete-tasks">Delete tasks</button>');
 $('#confirm-delete-tasks').onclick=()=>{
  const chosen=new Set(ids);
  state.tasks=state.tasks.filter(t=>!chosen.has(t.id));
  for(const task of state.tasks){
   if(chosen.has(task.parentId))task.parentId=null;
   task.dependencies=task.dependencies.filter(id=>!chosen.has(id));
  }
  for(const email of state.emails){
   email.taskIds=taskLinks(email).filter(id=>!chosen.has(id));email.taskId=null;
  }
  ids.forEach(id=>selectedTasks.delete(id));save();$('#detail').close();render();
 };
}
function typeDirectory(){
 openDialog('Task types',`<div class="inline-form"><input id="type-name" maxlength="60" placeholder="New task type" aria-label="New task type"><button id="add-type">Add</button></div>
 ${state.taskTypes.map((type,i)=>`<div class="inline-form"><input data-type-name="${i}" aria-label="Rename ${esc(type)}" maxlength="60" value="${esc(type)}"><button data-delete-type="${i}" class="danger">Delete</button></div>`).join('')}`);
 const update=(value,index)=>{
  const previous=state.taskTypes[index],name=value.trim();
  if(name&&state.taskTypes.some((type,i)=>i!==index&&name.toLowerCase()===type.toLowerCase()))return toast('That type already exists.');
  if(previous){
   if(name)state.taskTypes[index]=name;else state.taskTypes.splice(index,1);
   state.tasks.filter(t=>t.taskType===previous).forEach(t=>t.taskType=name);
   if(typeFilter===previous)typeFilter=name;
  }else if(name)state.taskTypes.push(name);else return;
  save();render();typeDirectory();
 };
 $('#add-type').onclick=()=>update($('#type-name').value,-1);
 document.querySelectorAll('[data-type-name]').forEach(input=>input.onchange=()=>{if(input.value.trim())update(input.value,+input.dataset.typeName);});
 document.querySelectorAll('[data-delete-type]').forEach(button=>button.onclick=()=>update('',+button.dataset.deleteType));
}
function clientDirectory(){
 openDialog('Clients',`<input type="search" id="client-search" placeholder="Find a client" aria-label="Find a client">
  <div id="client-directory">${state.clients.map(c=>`<div class="section-title client-row" data-client-name="${esc(c.name.toLowerCase())}"><button data-client-work="${esc(c.id)}">${esc(c.name)}</button><button data-edit-client="${esc(c.id)}">Edit</button></div>`).join('')}</div>`,'<button class="primary" id="new-client">New client</button>');
 $('#client-search').oninput=e=>document.querySelectorAll('[data-client-name]').forEach(row=>row.hidden=!row.dataset.clientName.includes(e.target.value.trim().toLowerCase()));
 $('#new-client').onclick=()=>clientEditor();
 document.querySelectorAll('[data-edit-client]').forEach(b=>b.onclick=()=>clientEditor(b.dataset.editClient));
 document.querySelectorAll('[data-client-work]').forEach(b=>b.onclick=()=>{
  const client=state.clients.find(c=>c.id===b.dataset.clientWork);
  openDialog(esc(client.name),`<div class="section-title"><h3>Operations</h3><button id="client-new-operation">New operation</button></div>${state.shipments.filter(s=>s.clientId===client.id||s.customer===client.name).map(s=>`<p><button data-open-operation="${esc(s.id)}">${esc(s.reference)}</button></p>`).join('')}<h3>Tasks</h3>${state.tasks.filter(t=>taskCustomer(t)===client.name).map(t=>`<p><button data-client-task="${esc(t.id)}">${esc(t.title)}</button> ${esc(t.status)}</p>`).join('')}`);
  $('#client-new-operation').onclick=()=>shipmentEditor(null,client.id);
  document.querySelectorAll('[data-client-task]').forEach(button=>button.onclick=()=>taskDetail(button.dataset.clientTask));
  document.querySelectorAll('[data-open-operation]').forEach(button=>button.onclick=()=>operationDetail(button.dataset.openOperation));
 });
}
function clientEditor(id){
 const client=state.clients.find(c=>c.id===id);
 openDialog(client?'Edit client':'New client',`<div class="task-properties">
  <label class="field">Name<input id="client-name" maxlength="120" value="${esc(client?.name)}"></label>
  <label class="field">Email domain<input id="client-domain" maxlength="150" placeholder="example.com" value="${esc(client?.domain)}"></label>
  <label class="field">Service commitments<input id="client-service" maxlength="240" value="${esc(client?.service)}"></label>
 </div>`,`${client?'<button class="danger" id="delete-client">Delete client</button>':''}<button class="primary" id="save-client">Save client</button>`);
 $('#save-client').onclick=()=>{
  const name=$('#client-name').value.trim(),domain=$('#client-domain').value.trim().toLowerCase();
  if(!name||state.clients.some(c=>c.id!==id&&(c.name.toLowerCase()===name.toLowerCase()||(domain&&c.domain===domain))))return toast('Enter a unique name and email domain.');
  if(domain&&!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain))return toast('Enter a domain such as example.com.');
  const values={name,domain,service:$('#client-service').value.trim()};
  if(client)Object.assign(client,values);else state.clients.push({id:uid(),...values});
  save();render();clientDirectory();
 };
 $('#delete-client')?.addEventListener('click',()=>{
  if(!confirm('Delete this client? Its name stays on linked tasks and operations.'))return;
  for(const item of [...state.tasks,...state.shipments])if(item.clientId===id){item.customer=client.name;item.clientId='';}
  state.clients=state.clients.filter(c=>c.id!==id);save();render();clientDirectory();
 });
}
function addMailLink(message,id){
 message.taskIds=[...new Set([...taskLinks(message),id])];
 message.taskId??=id;
}
function startEmailTask(message,title,requestKey){
 const {requests:_,...suggested}=mailSuggestions(message,state);
 const taskType=suggestTaskType(title||message.subject,state.taskTypes);
 const teams={'AES filing':'Ops',Pickup:'Ops',Documentation:'Ops','Inventory report':'Warehouse','Cargo release':'Warehouse'};
 const department=TEAMS.includes(teams[taskType])?teams[taskType]:'';
 const assignees=state.groups.find(item=>item.name===department)?.members||[];
 mailActionDraft={...suggested,taskType,title,requestKey,...(department?{team:department}:{}),...(assignees.length===1?{owner:assignees[0]}:{})};
 captureEmailId=message.id;render();$('#inline-capture input').focus();
}
function composerSuggestions(draft){
 const values=[['Client',state.clients.find(c=>c.id===draft.clientId)?.name],['Operation',shipment(draft.shipmentId)?.reference],
  ['Our ref',draft.ourReference],['Customer ref',draft.customerReference],['Type',draft.taskType],['Department',draft.team],
  ['Owner',draft.owner],['Requested by',draft.due&&fmt(draft.due)],['Cutoff',draft.cutoff&&fmt(draft.cutoff)]];
 const text=values.filter(([,value])=>value).map(([label,value])=>label+' · '+value).join('  |  ');
 return text?`<label class="check-row"><input type="checkbox" name="applySuggestions"> Use suggestions</label><small>${esc(text)}</small>
 <details class="quick-more"><summary>Correct suggestions</summary><div class="task-properties">
 ${values.map(([label],index)=>{
  const key=['clientId','shipmentId','ourReference','customerReference','taskType','team','owner','due','cutoff'][index];
  const choices={clientId:clientOptions(draft.clientId),shipmentId:operationOptions(draft.shipmentId),
   taskType:options(['',...state.taskTypes],draft.taskType),team:options(['',...TEAMS],draft.team||''),owner:options(USERS,draft.owner||'Unassigned')}[key];
  const control=choices?`<select data-suggested-field="${key}">${choices}</select>`:
   `<input data-suggested-field="${key}" type="${['due','cutoff'].includes(key)?'datetime-local':'text'}" maxlength="120" value="${esc(draft[key])}">`;
  return `<label class="field">${label}${control}</label>`;
 }).join('')}</div></details>`:'';
}
function emailUpdateCandidates(thread){
 const suggested=mailSuggestions(thread.latest,state);
 return state.tasks.filter(t=>thread.taskIds.includes(t.id)||t.status!=='Completed'&&(
  (suggested.shipmentId&&t.shipmentId===suggested.shipmentId)||
  (suggested.ourReference&&taskReferences(t).some(ref=>ref.toLowerCase()===suggested.ourReference.toLowerCase()))
 ));
}
function emailReview(message,tasks){
 const {requests}=mailSuggestions(message,state);
 if(!requests.length)return '<p class="muted">No clear action detected in this message.</p>';
 return `<details class="quick-more" open><summary>Review requests · ${requests.length}</summary>${requests.map((request,index)=>{
  const existing=state.tasks.find(task=>task.requestKey===message.id+':'+index);
  return `<div class="request-row"><span>${esc(request)}</span>${existing?'<small>Task already created</small>':tasks.length?`<button data-review-request="${index}">Review update</button><button data-new-request="${index}">New action</button>`:`<button data-new-request="${index}">Create action</button>`}</div>`;
 }).join('')}</details>`;
}
function bindEmailActions(thread,tasks){
 const chosen=()=>[...document.querySelectorAll('[data-select-mail]:checked')].map(control=>control.dataset.selectMail);
 const trash=inboxFilter==='Trash';
 const bulk=$('#bulk-mail-action');
 const changeTrash=(keys)=>{
  if(!keys.length)return toast('Select one or more conversations.');
  const now=new Date().toISOString();
  for(const mail of state.emails)if(keys.includes(mailKey(mail)))mail.deletedAt=trash?'':now;
  selectedThreads.clear();captureEmailId='';mailActionDraft=null;save();render();
  toast(trash?'Conversation restored':'Moved to Inboxy Trash');
 };
 bulk.onclick=()=>changeTrash(chosen());
 $('#select-mail').onchange=event=>{
  document.querySelectorAll('[data-select-mail]').forEach(control=>event.target.checked?selectedThreads.add(control.dataset.selectMail):selectedThreads.delete(control.dataset.selectMail));render();
 };
 document.querySelectorAll('[data-select-mail]').forEach(control=>control.onchange=()=>{control.checked?selectedThreads.add(control.dataset.selectMail):selectedThreads.delete(control.dataset.selectMail);render();});
 if(!thread)return;
 const email=thread.latest;
 $('#email-trash').onclick=()=>changeTrash([thread.key]);
 const suggestions=mailSuggestions(email,state);
 document.querySelectorAll('[data-new-request]').forEach(button=>button.onclick=()=>startEmailTask(email,suggestions.requests[+button.dataset.newRequest],email.id+':'+button.dataset.newRequest));
 document.querySelectorAll('[data-review-request]').forEach(button=>button.onclick=()=>reviewRequest(email,tasks,suggestions,suggestions.requests[+button.dataset.reviewRequest]));
 $('#email-link-operation')?.addEventListener('click',()=>{
  openDialog('Link operation',`<select id="mail-operation" aria-label="Operation">${operationOptions('')}</select>`,'<button class="primary" id="confirm-mail-operation">Link</button>');
  $('#confirm-mail-operation').onclick=()=>{
   const id=$('#mail-operation').value;if(!id)return toast('Choose an operation.');
   email.shipmentIds=[...new Set([...(email.shipmentIds||[]),id])];save();$('#detail').close();render();
  };
 });
 $('#email-edit')?.addEventListener('click',()=>{
  openDialog('Captured email',`<label class="field">Sender<input id="mail-edit-from" value="${esc(email.from)}"></label><label class="field">Subject<input id="mail-edit-subject" value="${esc(email.subject)}"></label><label class="field">Message<textarea id="mail-edit-body">${esc(email.body)}</textarea></label>`,'<button id="save-email-edits" class="primary">Save</button>');
  $('#save-email-edits').onclick=()=>{
   const from=$('#mail-edit-from').value.trim(),subject=$('#mail-edit-subject').value.trim();
   if(!from||!subject)return toast('Enter the sender and subject.');
   Object.assign(email,{from,subject,body:$('#mail-edit-body').value});save();$('#detail').close();render();
  };
 });
 bindAttachments();
}
function reviewRequest(email,tasks,suggestions,request){
 openDialog('Review customer instructions',`<div class="note"><strong>${esc(email.subject)}</strong><small>${esc(email.from)} · ${esc(fmt(email.date))}</small><p>${esc(request)}</p></div>
  <label class="field">Apply to<select id="update-target">${tasks.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select></label><div id="proposed-updates"></div>`,'<button id="apply-mail-update" class="primary">Apply selected changes</button>');
 const current=()=>tasks.find(t=>t.id===$('#update-target').value);
 const values={nextAction:request.slice(0,180),due:suggestions.due,cutoff:suggestions.cutoff};
 const labels={nextAction:'Next action',due:'Requested by',cutoff:'Hard cutoff'};
 const show=()=>$('#proposed-updates').innerHTML=Object.entries(values).filter(([key,value])=>value&&current()[key]!==value).map(([key,value])=>`<label class="check-row"><input type="checkbox" data-confirm-change="${key}"><span><strong>${labels[key]}</strong><br>Current: ${esc(current()[key]||'—')}<br>Proposed: ${esc(value)}</span></label>`).join('')||'<p>No changes detected.</p>';
 $('#update-target').onchange=show;show();
 $('#apply-mail-update').onclick=()=>{
  const selected=[...document.querySelectorAll('[data-confirm-change]:checked')];
  if(!selected.length)return toast('Select the changes to apply.');
  const task=current();
  for(const checkbox of selected){const key=checkbox.dataset.confirmChange;task[key]=values[key];}
  addMailLink(email,task.id);task.mailReviewedAt=new Date().toISOString();
  const changes=selected.map(box=>labels[box.dataset.confirmChange]).join(', ');
  activity(task,'Approved '+changes+' from “'+email.subject+'”');
  task.activity[0].emailId=email.id;
  save();render();taskDetail(task.id);
 };
}
function operationDetail(id){
 const operation=shipment(id);if(!operation)return;
 const tasks=state.tasks.filter(task=>task.shipmentId===id);
 const threads=conversations().filter(thread=>thread.shipmentIds.includes(id)||tasks.some(task=>thread.taskIds.includes(task.id)));
 openDialog(esc(operation.reference),`<p class="muted">${esc(state.clients.find(c=>c.id===operation.clientId)?.name||operation.customer)} · ${esc(operation.route)}</p>
  <h3>Tasks</h3>${tasks.map(t=>`<div class="section-title"><button data-operation-task="${esc(t.id)}">${esc(t.title)}</button><small>${esc(t.owner)} · ${esc(t.status)}</small></div>`).join('')||'<p>No tasks yet.</p>'}
  <div class="section-title"><h3>Documents</h3><button id="add-operation-document">Link document</button></div>
  ${(operation.documents||[]).filter(doc=>safeDocumentURL(doc.url)).map(doc=>`<div class="section-title"><a href="${esc(doc.url)}" target="_blank" rel="noopener noreferrer">${esc(doc.name)}</a><button data-edit-document="${esc(doc.id)}">Edit</button></div>`).join('')||'<p>No document links yet.</p>'}
  <h3>Conversations and attachments</h3>${threads.map(thread=>`<div class="note"><button data-operation-email="${esc(thread.latest.id)}">${esc(thread.latest.subject)}</button>${thread.messages.map(attachmentButtons).join('')}</div>`).join('')||'<p>No conversations linked.</p>'}
  <h3>Recent activity</h3>${tasks.flatMap(t=>t.activity.map(item=>({...item,title:t.title}))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(item=>`<p class="muted">${esc(item.title)} · ${esc(item.text)} · ${esc(fmt(item.date))}</p>`).join('')||'<p>No activity yet.</p>'}`,
  '<button id="operation-edit">Edit operation</button><button id="operation-all">View task list</button><button id="operation-task" class="primary">Add task</button>');
 const showWork=()=>{page='workspace';operationFilter=id;team='All teams';owner='All owners';scope='All tasks';view='List';query=customerFilter=statusFilter=priorityFilter=typeFilter=dueFilter=workQueue='';ftzOnly=attention=false;$('#detail').close();render();};
 $('#operation-edit').onclick=()=>shipmentEditor(id);
 $('#add-operation-document').onclick=()=>documentEditor(operation);
 document.querySelectorAll('[data-edit-document]').forEach(button=>button.onclick=()=>documentEditor(operation,button.dataset.editDocument));
 $('#operation-all').onclick=showWork;
 $('#operation-task').onclick=()=>{showWork();focusComposer();};
 document.querySelectorAll('[data-operation-task]').forEach(button=>button.onclick=()=>taskDetail(button.dataset.operationTask));
 document.querySelectorAll('[data-operation-email]').forEach(button=>button.onclick=()=>openInboxMessage(button.dataset.operationEmail));
 bindAttachments();
}
function openInboxMessage(id){
 const thread=conversations().find(item=>item.messages.some(message=>message.id===id));
 if(!thread)return;
 selectedEmail=id;captureEmailId='';mailActionDraft=null;mailQuery='';
 inboxFilter=thread.latest.deletedAt?'Trash':personalState('inbox-view')[thread.key]?.latestId===thread.latest.id?'Archived':'Inbox';
 $('#detail').close();page='inbox';render();
}
function safeDocumentURL(value){
 try{return new URL(value).protocol==='https:';}catch{return false;}
}
function documentEditor(operation,id){
 const documentLink=(operation.documents||[]).find(item=>item.id===id);
 openDialog(documentLink?'Edit document link':'Link document',`<label class="field">Name<input id="document-name" maxlength="120" value="${esc(documentLink?.name)}"></label><label class="field">HTTPS link<input id="document-url" type="url" value="${esc(documentLink?.url)}"></label>`,
 `${documentLink?'<button class="danger" id="delete-document">Remove link</button>':''}<button id="save-document" class="primary">Save link</button>`);
 const done=()=>{save();render();operationDetail(operation.id);};
 $('#save-document').onclick=()=>{
  const name=$('#document-name').value.trim(),url=$('#document-url').value.trim();
  if(!name||!safeDocumentURL(url))return toast('Enter a document name and an HTTPS link.');
  operation.documents??=[];
  if(documentLink)Object.assign(documentLink,{name,url});else operation.documents.push({id:uid(),name,url});
  done();
 };
 $('#delete-document')?.addEventListener('click',()=>{operation.documents=operation.documents.filter(item=>item.id!==id);done();});
}
function attachmentButtons(message){
 return (message.attachments||[]).map((file,index)=>`<button data-attachment="${esc(message.id)}" data-attachment-index="${index}">${esc(file.name)} ↓</button>`).join('');
}
function bindAttachments(){
 document.querySelectorAll('[data-attachment]').forEach(button=>button.onclick=async()=>{
  const email=state.emails.find(item=>item.id===button.dataset.attachment);
  button.disabled=true;
  try{
   const {data,name}=await mailAction('attachment',{connection:email.connectionId,email:email.id,index:+button.dataset.attachmentIndex});
   const bytes=Uint8Array.from(atob(data.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
   download(name,bytes,'application/octet-stream');
  }catch(error){toast(error.message);}finally{button.disabled=false;}
 });
}
function rowDates(button){
 const task=state.tasks.find(t=>t.id===button.dataset.rowDates);
 const labels={due:'Requested by',cutoff:'Hard cutoff',followUp:'Follow-up reminder'};
 const fields=button.dataset.dateKind==='deadline'?['cutoff']:['followUp'];
 const requested=button.dataset.dateKind==='deadline'?`<label class="field">Requested date<input id="requested-date" type="date" value="${esc(task.due?.slice(0,10))}"></label><label class="field">Requested time (optional)<input id="requested-time" type="time" value="${esc(task.due?.slice(11,16))}"></label>`:'';
 openDialog(esc(task.title),`<div class="task-properties">${requested}${fields.map(key=>`<label class="field">${labels[key]}<input data-date-property="${key}" type="datetime-local" value="${esc(task[key])}"></label>`).join('')}</div>`,'<button class="primary" id="save-row-dates">Save dates</button>');
 $('#save-row-dates').onclick=()=>{
  if(requested){
   const date=$('#requested-date').value,time=$('#requested-time').value;
   const next=date&&time?date+'T'+time:date;
   if(next!==(task.due||'')){task.due=next;activity(task,'Updated requested deadline');}
  }
  for(const input of document.querySelectorAll('[data-date-property]')){
   const key=input.dataset.dateProperty;
   if((task[key]||'')===input.value)continue;
   task[key]=input.value;activity(task,'Updated '+labels[key].toLowerCase());
  }
  save();$('#detail').close();render();
 };
}

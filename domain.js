export const TEAMS = ['Ops','Warehouse','Accounting','Pricing'];
export const STATUSES = ['Up next','In progress','Waiting','Ready to bill','Completed'];
export const USERS = ['Unassigned','Ignacio','Sofia','Carlos','Emma','Daniel'];
export const uid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
export function blockedBy(task, tasks) { return tasks.filter(t => task.dependencies.includes(t.id) && t.status !== 'Completed'); }
export function descendants(id, tasks) { const children = tasks.filter(t=>t.parentId===id); return children.flatMap(t=>[t,...descendants(t.id,tasks)]); }
export function completionIssue(task, tasks) {
 if (blockedBy(task,tasks).length) return 'Complete the blocking tasks first.';
 if (descendants(task.id,tasks).some(t=>t.status!=='Completed')) return 'Complete all subtasks first.';
 return '';
}
export function priority(task, tasks, now = new Date()) {
 if(task.status==='Completed') return {score:-1,reasons:['Completed']};
 let score={Urgent:80,High:45,Normal:15,Low:0}[task.priority]??15; const reasons=[];
 const due=task.due?new Date(task.due).getTime():null;
 if(due && due < +now){score+=100;reasons.push('Overdue');}
 else if(due && due- +now<=86400000){score+=55;reasons.push('Due within 24h');}
 if(task.followUp && +new Date(task.followUp)<= +now){score+=65;reasons.push('Follow-up due');}
 if(task.owner==='Unassigned'){score+=25;reasons.push('Needs owner');}
 if(task.impact){score+=35;reasons.push('Operational impact');}
 const dependents=tasks.filter(t=>t.dependencies.includes(task.id)&&t.status!=='Completed').length;
 if(dependents){score+=30;reasons.push(`Blocks ${dependents} task${dependents>1?'s':''}`);}
 if(blockedBy(task,tasks).length) reasons.push('Blocked');
 if(!reasons.length) reasons.push(`${task.priority} priority`);
 return {score,reasons};
}
export function customerSnapshot(shipment, tasks) {
 return {reference:shipment.reference,customer:shipment.customer,status:shipment.publicStatus,update:shipment.publicUpdate,nextUpdate:shipment.nextUpdate,milestones:tasks.filter(t=>t.shipmentId===shipment.id&&t.public).map(t=>({title:t.publicTitle||t.title,status:t.status==='Completed'?'Complete':t.status==='Up next'?'Planned':'In progress'}))};
}
export function parseEmail(raw) {
 const split=raw.search(/\r?\n\r?\n/); const headers=(split<0?raw:raw.slice(0,split)).replace(/\r?\n[ \t]+/g,' ');
 const header=name=>headers.match(new RegExp(`^${name}:\\s*(.*)$`,'im'))?.[1]?.trim()||'';
 const body=split<0?'':raw.slice(split).trim();
 if(!header('subject')&&!header('from')) throw new Error('This file does not contain recognizable email headers.');
 if(/multipart|text\/html/i.test(header('Content-Type'))||/base64|quoted-printable/i.test(header('Content-Transfer-Encoding'))) throw new Error('Import a plain-text .eml email. Encoded or multipart emails are not supported yet.');
 return {id:uid(),subject:header('subject')||'(No subject)',from:header('from'),body,date:header('date'),taskId:null};
}
export function seed() {
 const date=(h)=>{const d=new Date(Date.now()+h*3600000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const shipments=[{id:'s1',reference:'SHP-1042',customer:'ABC Imports',route:'Miami → Quito',container:'MSCU 704219-6',publicStatus:'Preparing for pickup',publicUpdate:'Your shipment is being prepared for pickup. We will confirm the appointment once preparation is complete.',nextUpdate:date(5)},{id:'s2',reference:'SHP-1043',customer:'Andes Trading',route:'Port Everglades → Miami',container:'TCLU 382910-1',publicStatus:'Documents under review',publicUpdate:'We are reviewing the release documents and coordinating the next steps.',nextUpdate:date(8)}];
 const base={owner:'Ignacio',team:'Ops',status:'Up next',priority:'Normal',due:date(8),followUp:'',nextAction:'',description:'',parentId:null,dependencies:[],notes:[],activity:[],public:false,impact:false};
 const tasks=[
 {...base,id:'t1',title:'Coordinate pickup for ABC Imports',shipmentId:'s1',priority:'High',due:date(4),nextAction:'Confirm appointment after warehouse preparation',dependencies:['t2'],description:'Pickup of 4 pallets. Confirm carrier and appointment before dispatch.',public:true,publicTitle:'Confirm pickup appointment'},
 {...base,id:'t2',title:'Wrap pallet before pickup',shipmentId:'s1',team:'Warehouse',owner:'Carlos',status:'In progress',priority:'Urgent',due:date(2),nextAction:'Finish wrapping and confirm ready',description:'Pallet 3 of 4. Check corners and use stretch wrap. Record completion in the notes.',parentId:'t1',public:true,publicTitle:'Warehouse preparation',impact:true},
 {...base,id:'t3',title:'Confirm wrapping charge',shipmentId:'s1',team:'Pricing',owner:'Sofia',due:date(3),nextAction:'Approve the accessorial rate'},
 {...base,id:'t4',title:'Invoice wrapping service',shipmentId:'s1',team:'Accounting',owner:'Emma',status:'Waiting',dependencies:['t2','t3'],nextAction:'Prepare invoice after service and rate approval'},
 {...base,id:'t5',title:'Obtain missing cargo release',shipmentId:'s2',owner:'Unassigned',priority:'Urgent',due:date(-5),followUp:date(-1),nextAction:'Follow up with broker',description:'Release is missing. Cargo cannot move until authorization is received.',impact:true,public:true,publicTitle:'Release documentation'},
 {...base,id:'t6',title:'Send revised delivery quote',shipmentId:'s2',team:'Pricing',owner:'Daniel',priority:'High',due:date(6),nextAction:'Review rate and respond to requester'},
 {...base,id:'t7',title:'Check pallet condition',shipmentId:'s1',team:'Warehouse',owner:'Carlos',status:'Completed',parentId:'t2',nextAction:'Inspection complete'},
 {...base,id:'t8',title:'Reconcile handling charges',shipmentId:'s2',team:'Accounting',owner:'Emma',status:'Ready to bill',due:date(20),nextAction:'Check approved charges against invoice'}];
 return {version:1,shipments,tasks,emails:[{id:'e1',from:'Maria Torres <maria@example.com>',subject:'Pickup request · ABC Imports · 4 pallets',body:'Please arrange pickup for our 4 pallets. Pallet 3 needs wrapping before collection. Please confirm the pickup appointment and wrapping charge.',date:date(-2),taskId:'t1'},{id:'e2',from:'Luis Vega <luis@example.com>',subject:'Revised delivery quote — Andes Trading',body:'Could you send the revised delivery rate and confirm when the shipment can be released?',date:date(-1),taskId:null}],drafts:[]};
}

// One transition rule for board drops, menus, and completion actions.
export function transitionIssue(task, status, tasks) {
 if (!STATUSES.includes(status)) return 'Choose a valid status.';
 return status === 'Completed' ? completionIssue(task, tasks) : '';
}
export function moveTask(tasks, id, status, beforeId=null) {
 const task=tasks.find(t=>t.id===id);
 if(!task) return 'Task no longer exists.';
 const issue=transitionIssue(task,status,tasks); if(issue) return issue;
 const column=tasks.filter(t=>t.id!==id&&t.status===status).sort((a,b)=>(a.boardOrder??tasks.indexOf(a))-(b.boardOrder??tasks.indexOf(b)));
 const index=beforeId?column.findIndex(t=>t.id===beforeId):-1;
 column.splice(index<0?column.length:index,0,task);
 task.status=status;
 column.forEach((t,i)=>t.boardOrder=i);
 return '';
}

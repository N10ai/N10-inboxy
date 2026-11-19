export const defaultTypes = ['AES filing', 'Pickup', 'Documentation', 'Inventory report', 'Cargo release'];
export const priorities = ['Urgent', 'High', 'Normal', 'Low'];

export function taskLinks(message) {
 return [...new Set([...(message.taskIds || []), message.taskId].filter(Boolean))];
}

export function dateOnly(value) {
 return /^\d{4}-\d{2}-\d{2}$/.test(value||'');
}
export function dueTime(value) {
 return value?+new Date(dateOnly(value)?value+'T23:59:59.999':value):Infinity;
}
export function deadline(task) {
 return [task.cutoff, task.due].filter(Boolean).sort((a,b)=>dueTime(a)-dueTime(b))[0] || '';
}

export function isActionable(task, now = Date.now()) {
 return task.status !== 'Completed' && (task.status !== 'Waiting' ||
  [deadline(task), task.followUp].some(value=>value && dueTime(value)<=now+3600000));
}

export function mailSuggestions(message, workspace) {
 const content = message.body.split(/^\s*(?:>|On .+ wrote:|-----Original Message-----)/mi)[0];
 const lines = content.split(/\r?\n/).map(line=>line.trim().replace(/^(?:[-•*]|\d+[.)])\s+/, ''));
 const action = /^(?:(?:please|kindly)\s+|(?:can|could|would) you\s+)?(?:file|schedule|book|arrange|confirm|send|provide|pick up|release|deliver|correct|update|count|check|prepare|move|reschedule|cancel|submit)\b/i;
 const requests = lines.filter(line=>action.test(line)).slice(0,8);
 const address = (message.from.match(/<([^>]+)>/)?.[1] || message.from).toLowerCase().trim();
 const client = (workspace.clients || []).find(item=>item.domain &&
  address.split('@')[1]===item.domain.toLowerCase());
 const reference = (label)=>new RegExp('(?:^|[\\s,])'+label+'\\s*[:#]\\s*([A-Z0-9][A-Z0-9./_-]+)','i')
  .exec(message.subject+'\n'+content)?.[1] || '';
 const ourReference = reference('(?:our reference|shipment|booking)');
 const customerReference = reference('(?:PO|customer reference)');
 const shipment = workspace.shipments.find(item=>item.reference.toLowerCase()===ourReference.toLowerCase() && ourReference);
 const date = label=>new RegExp('\\b'+label+'\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2})(?![:\\dZ+−-])','i').exec(content)?.slice(1).join('T') || '';
 return {requests, clientId:client?.id, shipmentId:shipment?.id, ourReference, customerReference,
  due:date('(?:due|deadline)'), cutoff:date('cutoff')};
}

export function suggestTaskType(title, types) {
 const matchers = {'AES filing':/\baes\b/i, Pickup:/pick.?up/i, Documentation:/document|invoice|packing list/i,
  'Inventory report':/inventory|count/i, 'Cargo release':/release/i};
 return types.find(type=>matchers[type]?.test(title) || title.toLowerCase().includes(type.toLowerCase())) || '';
}

export function relatedTaskIds(messages) {
 return [...new Set(messages.flatMap(taskLinks))];
}

// Suggest a date only when the revision gives one exact local date and time.
export function cutoffRevision(message) {
 const content=(message.body||'').split(/^\s*(?:>|On .+ wrote:|-----Original Message-----)/mi)[0];
 const lines=content.split(/\r?\n/).map(line=>line.trim()).filter(line=>
  /^(?:(?:the )?(?:new|revised|updated) (?:[\w-]+ ){0,3}cut[ -]?off\b|(?:the )?(?:[\w-]+ ){0,3}cut[ -]?off (?:has been |is |was )?(?:changed|revised|moved|updated)\b)/i.test(line));
 if(!lines.length)return null;
 const exact=lines.length===1&&lines[0].match(/(?:\bto\s+|:\s*|\bis\s+)(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})[.!]?$/i);
 const value=exact?exact[1]+'T'+exact[2]:'';
 const date=value&&new Date(value);
 const valid=date&&Number.isFinite(+date)&&date.getFullYear()===Number(value.slice(0,4))&&
  date.getMonth()+1===Number(value.slice(5,7))&&date.getDate()===Number(value.slice(8,10))&&
  date.getHours()===Number(value.slice(11,13))&&date.getMinutes()===Number(value.slice(14));
 return {source:lines.join('\n'),value:valid?value:''};
}

/* Pure Homework workspace projection. Display-only; the API owns permissions. */
(function (root) {
  "use strict";
  function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function project(items, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const today = localDate(now); const end = new Date(now); end.setDate(end.getDate()+7);
    const scoped = (Array.isArray(items) ? items : []).filter(item => item &&
      (!options.kidId || item.kidId === options.kidId) && (!options.subject || item.subject === options.subject));
    const open = scoped.filter(item => item.status !== 'done');
    const completed = scoped.filter(item => item.status === 'done');
    const visible = (options.status === 'done' ? completed : open).slice().sort((a,b) =>
      String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) ||
      String(a.dueTime || '99').localeCompare(String(b.dueTime || '99')) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
    const groups = [];
    for (const item of visible) {
      const key = item.dueDate || '';
      let group = groups[groups.length-1];
      if (!group || group.date !== key) { group = {date:key, overdue:!!key && key<today && options.status!=='done', items:[]}; groups.push(group); }
      group.items.push(item);
    }
    return {visible, groups, counts:{open:open.length, done:completed.length,
      soon:open.filter(x => x.dueDate && x.dueDate >= today && x.dueDate <= localDate(end)).length,
      overdue:open.filter(x => x.dueDate && x.dueDate < today).length}, today};
  }
  function effort(value) {
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes <= 0) return 'Not estimated';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes/60)}h${minutes%60 ? ` ${minutes%60}m` : ''}`;
  }
  root.famHomeworkWorkspace = {project, effort};
})(typeof window !== 'undefined' ? window : globalThis);

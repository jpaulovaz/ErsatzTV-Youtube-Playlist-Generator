(function attachScriptedScheduleEditorUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ScriptedScheduleEditorUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function collectModuleIds(modules) {
    const ids = new Set();
    for (const items of Object.values(modules || {})) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const id = String(item?.id || '').trim();
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  function nextCopyId(originalId, modules) {
    const sourceId = String(originalId || '').trim();
    if (!sourceId) return '';
    const used = collectModuleIds(modules);
    const base = `${sourceId}_copy`;
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  function cloneModuleEntry(entry, modules) {
    if (!entry || typeof entry !== 'object') return null;
    const clone = deepClone(entry);
    const originalId = String(entry.id || '').trim();
    if (originalId) clone.id = nextCopyId(originalId, modules);
    if (String(entry.label || '').trim()) clone.label = `${String(entry.label).trim()} (cópia)`;
    return clone;
  }

  function duplicateModuleEntry(modules, type, index) {
    const items = modules?.[type];
    const sourceIndex = Number(index);
    if (!Array.isArray(items) || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= items.length) return null;
    const clone = cloneModuleEntry(items[sourceIndex], modules);
    if (!clone) return null;
    const insertedIndex = sourceIndex + 1;
    items.splice(insertedIndex, 0, clone);
    return { item: clone, index: insertedIndex };
  }

  return { deepClone, collectModuleIds, nextCopyId, cloneModuleEntry, duplicateModuleEntry };
});

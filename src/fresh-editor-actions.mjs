const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Return exact target-instance delete action indexes; callers must require one. */
export function matchingDeleteActionIndexes(actions, settingId) {
  if (!settingId) return [];
  const expectedDataId = `siteblocks-setting-wrap-${settingId}`;
  return (actions || []).flatMap((action, index) => {
    if (action.visible === false || action.dataId !== expectedDataId) return [];
    const labels = [action.text, action.title, action.ariaLabel].map(normalize).filter(Boolean);
    const hasExactDeleteLabel = labels.some((label) => ['删除', 'delete', 'remove'].includes(label));
    const icons = (action.iconClasses || []).map(normalize).join(' ');
    const hasDeleteIcon = /(?:^|[\s_-])(?:icon-trash|icon-delete|fa-trash|fa-trash-o|trash|delete)(?:$|[\s_-])/.test(icons);
    return hasExactDeleteLabel && hasDeleteIcon ? [index] : [];
  });
}

/** Resolve only a uniquely identified destructive confirmation action. */
export function matchingDeleteConfirmIndexes(actions) {
  return (actions || []).flatMap((action, index) => {
    if (action.visible === false) return [];
    const label = normalize([action.text, action.title, action.ariaLabel].filter(Boolean).join(' '));
    return ['删除', 'delete', 'remove', '确定', 'confirm'].includes(label) ? [index] : [];
  });
}

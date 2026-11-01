const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function annotateControlsWithSections(controls = [], sections = []) {
  return controls.map((control, index) => {
    const section = normalize(sections[index]);
    return section ? { ...control, section } : control;
  });
}

export function matchUniqueControlSection(candidates = [], sectionName) {
  const wanted = normalize(sectionName);
  const matches = candidates.filter((item) => item.visible !== false && normalize(item.name) === wanted);
  return { count: matches.length, match: matches.length === 1 ? matches[0] : null };
}

/** Attach only explicit accessible/structural group names to inventory controls. */
export async function annotateControlSections(root, controls = []) {
  const sections = await root.evaluate((container) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const labelOf = (node) => {
      if (!node) return '';
      const labelled = node.getAttribute('aria-labelledby');
      const referenced = labelled ? labelled.split(/\s+/).map((id) => node.ownerDocument.getElementById(id)?.textContent || '').join(' ') : '';
      const legend = node.querySelector?.(':scope > legend')?.textContent || '';
      return norm(node.getAttribute('aria-label') || node.getAttribute('data-section')
        || node.getAttribute('data-group') || node.getAttribute('title') || referenced || legend);
    };
    return [...container.querySelectorAll('input,select,textarea')].map((input) => {
      for (let node = input.parentElement; node && node !== container; node = node.parentElement) {
        const role = node.getAttribute('role');
        const isGroup = ['group', 'tabpanel'].includes(role) || node.tagName === 'FIELDSET'
          || node.hasAttribute('data-section') || node.hasAttribute('data-group');
        if (!isGroup) continue;
        const name = labelOf(node);
        if (name) return name;
      }
      const panel = input.closest('[role="tabpanel"]');
      const tabId = panel?.getAttribute('aria-labelledby');
      if (tabId) {
        const tab = input.ownerDocument.getElementById(tabId);
        const name = norm(tab?.getAttribute('aria-label') || tab?.textContent);
        if (name) return name;
      }
      return '';
    });
  });
  return annotateControlsWithSections(controls, sections);
}

/** Activate one uniquely identified accessible section; never guess a tab. */
export async function openControlSection(root, sectionName) {
  const wanted = normalize(sectionName);
  const selector = '[role="tab"], [data-section], [data-group], fieldset > legend';
  const candidates = await root.locator(selector)
    .evaluateAll((nodes) => nodes.map((node, index) => ({
      index,
      name: (node.getAttribute('aria-label') || node.getAttribute('data-section')
        || node.getAttribute('data-group') || node.textContent || '').replace(/\s+/g, ' ').trim(),
      visible: node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden',
      selected: node.getAttribute('aria-selected') === 'true',
      controls: node.getAttribute('aria-controls') || '',
      tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || '',
    })));
  const { count, match } = matchUniqueControlSection(candidates, wanted);
  if (count !== 1 || !match) throw new Error(`Requested settings section matched ${count} visible controls; expected exactly one.`);
  if (match.role === 'tab' && !match.selected) {
    const target = root.locator(selector).nth(match.index);
    if (await target.count() !== 1 || !(await target.isVisible())) throw new Error('Settings section locator changed after inventory; refusing ambiguous activation.');
    await target.evaluate((node) => node.click());
  }
  if (match.controls) {
    const panel = root.locator(`[id=${JSON.stringify(match.controls)}]`);
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
  }
  return { name: wanted, activated: match.role === 'tab' && !match.selected };
}

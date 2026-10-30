// Delete ONE product category by id, only if it is a leaf with 0 products.
// Usage: node scripts/maintenance/delete-empty-category.mjs <groupId> <exact name>
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';
const [id, name] = process.argv.slice(2);
if (!id || !name) throw new Error('usage: <groupId> <name>');
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
let code = 1;
try {
  await openEditor(page, config);
  const prod = await openProdPage(context);
  const u = new URL(prod.url()); u.search = ''; u.searchParams.set('invokeAction', 'prod_group_list');
  const load = async () => { await prod.goto(u.href, { waitUntil: 'load' }); await prod.waitForTimeout(6000); };
  await load();
  const info = await prod.evaluate(id => {
    const box = document.querySelector(`input[name="dataId"][value="${id}"]`); if (!box) return null;
    const row = box.closest('tr');
    const kids = [...document.querySelectorAll('tr[parentgroup]')].filter(r => r.getAttribute('parentgroup').split(',').includes(id)).length;
    return { name: box.getAttribute('groupname'), leaf: box.getAttribute('isleafage'), count: row.children[2]?.innerText.trim(), kids,
      actions: [...row.querySelectorAll('[action],[onclick]')].map(a => (a.getAttribute('action') || '') + '|' + (a.getAttribute('onclick') || '').slice(0, 80)) };
  }, id);
  console.log(JSON.stringify(info));
  if (!info || info.name !== name || info.leaf !== 'true' || info.count !== '0' || info.kids) throw new Error('pre-check failed');
  prod.on('dialog', d => { console.log('dialog:', d.message()); d.accept(); });
  const del = prod.locator(`#light${id} [action="prod_group_delete"]`);
  if (await del.count() !== 1) throw new Error('delete action not unique');
  await del.click();
  await prod.waitForTimeout(3000);
  const yes = prod.locator('#popupLayer_sysConfirmPop #confirmYes');
  if (await yes.count() !== 1) throw new Error('confirm not found');
  await yes.click(); await prod.waitForTimeout(5000);
  await load();
  const gone = await prod.locator(`input[name="dataId"][value="${id}"]`).count() === 0;
  console.log('deleted:', gone); code = gone ? 0 : 2;
} catch (e) { console.log('error', e.message); }
await browser.close(); process.exit(code);

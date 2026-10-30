// Read-only inspection of the add-category form; never submits it.
import { loadConfig } from '../../../src/config.mjs';
import { launchSession } from '../../../src/browser.mjs';
import { openEditor } from '../../../src/editor.mjs';
import { openProdPage } from '../../../src/cms.mjs';
const config = loadConfig();
const { browser, context, page } = await launchSession(config);
try {
  await openEditor(page, config);
  const prod = await openProdPage(context);
  const url = new URL(prod.url()); url.search = ''; url.searchParams.set('invokeAction', 'prod_group_add');
  await prod.goto(url.href, { waitUntil: 'load' }); await prod.waitForTimeout(5000);
  console.log(JSON.stringify(await prod.evaluate(() => {
    const form = document.querySelector('form[action*="group/doAdd"]');
    if (!form) return { error: 'category form missing' };
    const location = form.querySelector('#strParentGroup');
    return { locationValue: location?.value, selected: [...form.querySelectorAll('.selectedTreeRow')].map(n => n.innerText),
      buttons: [...document.querySelectorAll('button,input[type=submit],input[type=button],a,[action]')]
        .filter(n => n.getClientRects().length && /保存|提交|确定/.test(n.innerText || n.value || ''))
        .map(n => n.outerHTML.slice(0, 500)) };
  }), null, 2));
} finally { await browser.close(); }

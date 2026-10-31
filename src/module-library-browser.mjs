import fs from 'node:fs/promises';
import path from 'node:path';
import { probeTargetAcrossModes, searchTargetInMode } from './module-library-inventory.mjs';
import { retryEnvironmentTimeout } from './ui-waits.mjs';

/** Uses the same first canvas wrapper/add control as the proven add path. */
export async function inspectActiveModuleLibraryOpener(frame) {
  const wrapper = frame.locator('#backstage-bodyArea .backstage-creatmodules-wrapper').first();
  const locator = wrapper.locator('.backstage-creatmodules-addbtn').first();
  return { locator, matchCount: await locator.count() };
}

/** Target-only UI adapter shared by onboarding, read-only inventory, and add. */
export async function probeModuleLibraryModes({ page, panel, targetBlockId, config, modes = ['review', 'develop', 'online'] }) {
  const target = String(targetBlockId);
  return probeTargetAcrossModes({ targetBlockId: target, modes,
    probeMode: async ({ mode }) => {
      const candidate = panel.locator(`.btn.add[appid=${JSON.stringify(target)}]`);
      return searchTargetInMode({ mode, targetBlockId: target,
        selectMode: async () => {
          if (mode === 'online') return;
          const value = mode === 'develop' ? '-1' : '-2';
          const tab = panel.locator(`.user-handle-module[value="${value}"]`);
          if (await tab.count() !== 1) throw Object.assign(new Error(`Mode ${mode} tab is unavailable or ambiguous.`), { code: 'MODE_UNAVAILABLE', searched: false });
          await tab.first().click({ timeout: config.actionTimeoutMs });
        },
        submitTarget: async (id) => {
          const search = panel.locator('.addmodules_searchWrap input');
          if (await search.count() !== 1) throw Object.assign(new Error(`Target search control unavailable in ${mode}.`), { code: 'TARGET_SEARCH_UNAVAILABLE', searched: false });
          await search.first().fill(id);
          await search.first().press('Enter');
        },
        waitForLazyResults: async () => retryEnvironmentTimeout(() => candidate.waitFor({
          state: 'attached', timeout: Number(config.libraryResultTimeoutMs) || 8_000,
        }), { stage: 'library-load' }).catch((error) => { if (error.name !== 'TimeoutError') throw error; }),
        scrollResultsToEnd: async () => {
          for (let pass = 0; pass < 8; pass += 1) {
            await panel.evaluate((root) => {
              for (const node of [root, ...root.querySelectorAll('*')]) {
                if (node.scrollHeight > node.clientHeight + 2
                  && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight;
              }
            });
            if (pass < 7) await page.waitForTimeout(250);
          }
        },
        targetPresent: async () => {
          const count = await candidate.count();
          if (count > 1) throw new Error(`Target ${target} matched ${count} rows in ${mode}; refusing ambiguity.`);
          return count === 1;
        },
        captureMissing: async () => null,
      });
    },
    captureMissing: async (mode, id) => {
      const root = config.projectRoot || process.cwd();
      const directory = path.resolve(root, 'logs');
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `module-library-${id}-${mode}-not-found.png`);
      await page.screenshot({ path: file, fullPage: true, timeout: 30_000 });
      return file;
    },
  });
}

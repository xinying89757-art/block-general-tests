import fs from 'node:fs/promises';
import path from 'node:path';
import { probeTargetAcrossModes, searchTargetInMode } from './module-library-inventory.mjs';
import { retryEnvironmentTimeout } from './ui-waits.mjs';

/**
 * Resolve a single visible control inside an already-scoped surface. Hidden
 * responsive/editor clones do not make a visible action ambiguous.
 */
export async function waitForUniqueVisibleControl(scope, selector, label, timeoutMs = 8_000) {
  const visible = scope.locator(`${selector}:visible`);
  await visible.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const count = await visible.count();
  if (count !== 1) {
    throw Object.assign(new Error(`${label} has ${count} visible matches in the active module-library panel.`), {
      code: 'LIBRARY_CONTROL_AMBIGUOUS', searched: false,
    });
  }
  return visible.first();
}

export async function waitForUniqueVisibleModuleLibraryPanel(page, timeoutMs = 30_000) {
  return waitForUniqueVisibleControl(page, '.backstage-addmodules-chooseWrapper', 'Module-library panel', timeoutMs);
}

/** Uses the same first canvas wrapper/add control as the proven add path. */
export async function inspectActiveModuleLibraryOpener(frame) {
  const wrapper = frame.locator('#backstage-bodyArea .backstage-creatmodules-wrapper').first();
  const locator = wrapper.locator('.backstage-creatmodules-addbtn').first();
  return { locator, matchCount: await locator.count() };
}

/** Target-only UI adapter shared by onboarding, read-only inventory, and add. */
export async function probeModuleLibraryModes({ page, panel, targetBlockId, config, modes = ['online', 'develop', 'review'] }) {
  const target = String(targetBlockId);
  return probeTargetAcrossModes({ targetBlockId: target, modes,
    probeMode: async ({ mode }) => {
      const candidate = panel.locator(`.btn.add[appid=${JSON.stringify(target)}]`);
      return searchTargetInMode({ mode, targetBlockId: target,
        selectMode: async () => {
          if (mode === 'online') return;
          const value = mode === 'develop' ? '-1' : '-2';
          const tab = await waitForUniqueVisibleControl(panel, `.user-handle-module[value="${value}"]`, `Mode ${mode} tab`,
            Number(config.libraryControlTimeoutMs) || 8_000);
          await tab.click({ timeout: config.actionTimeoutMs });
        },
        submitTarget: async (id) => {
          const search = await waitForUniqueVisibleControl(panel, '.addmodules_searchWrap input', `Target search input (${mode})`,
            Number(config.libraryControlTimeoutMs) || 8_000);
          await search.fill(id);
          await search.press('Enter');
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

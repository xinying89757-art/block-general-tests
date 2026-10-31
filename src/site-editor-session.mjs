import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSession } from './browser.mjs';
import { ensureTargetPage, openEditor } from './editor.mjs';
import { openWithLoginRecovery } from './editor-session-recovery.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function launchTargetEditor(config) {
  const opened = await openWithLoginRecovery({
    launch: () => launchSession(config),
    open: async (session) => {
      session.page = (await openEditor(session.page, config)).page;
      const target = await ensureTargetPage(session.page, config);
      return { page: session.page, canvas: target.frame, context: session.context };
    },
    forceLogin: () => {
      const result = spawnSync(process.execPath, ['scripts/explore-login.mjs', '--force-login'], {
        cwd: projectRoot, stdio: 'ignore', timeout: 120_000, env: process.env,
      });
      if (result.error || result.status !== 0) throw new Error('force-login failed');
    },
  });
  if (opened.loginRefreshed) console.log('[login] 检测到编辑器/站点身份未就绪，force-login 一次后重试成功。');
  return { session: opened.session, ...opened.value, loginRefreshed: opened.loginRefreshed };
}

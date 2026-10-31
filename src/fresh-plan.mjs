import { planSettingBatches } from './batch-save.mjs';

/**
 * Produce a metadata-only dry run before opening the editor. Concrete settings
 * may be absent on a particular instance; the live flow prints its discovered
 * plan again after reading that fresh instance's controls.
 */
export function planDeclaredFreshSettings({ settingKeys = [], metadata = {} } = {}) {
  const keys = [...new Set(settingKeys.map((key) => String(key || '').trim()).filter(Boolean))];
  const planned = planSettingBatches(keys.map((key) => ({ id: key, key })), metadata);
  return {
    basis: 'declared-setting-keys; concrete controls are discovered in the editor',
    batches: planned.map(({ settings, restoreBefore }, index) => ({
      index, settingKeys: settings.map((item) => item.key), restoreBefore,
    })),
  };
}

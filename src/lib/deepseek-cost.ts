// DeepSeek V4 pricing (元/百万 tokens) + peak/off-peak cost estimation.
//
// Pricing source: DeepSeek 2026-08-17 峰谷定价公告.
//   - 高峰 = 低谷价 × 2
//   - 高峰时段 (北京时间): 09:00–12:00 与 14:00–18:00
//   - 缓存写入 (cache creation) 按"输入(缓存未命中)"价计费
//
// V4-Pro  低谷: 输入未命中 4.5 / 缓存命中 0.15 / 输出 13.5 (元/百万)
// V4-Flash 低谷: 输入未命中 1.5 / 缓存命中 0.05 / 输出 4.5 (元/百万)

export type DeepSeekTier = 'pro' | 'flash';

export interface DeepSeekRates {
  /** 输入（缓存未命中）元/百万 */
  inputPerM: number;
  /** 输入（缓存命中）元/百万 */
  cacheHitPerM: number;
  /** 输出 元/百万 */
  outputPerM: number;
}

const OFF_PEAK_RATES: Record<DeepSeekTier, DeepSeekRates> = {
  pro: { inputPerM: 4.5, cacheHitPerM: 0.15, outputPerM: 13.5 },
  flash: { inputPerM: 1.5, cacheHitPerM: 0.05, outputPerM: 4.5 },
};

export function modelTier(model: string | undefined): DeepSeekTier {
  return model && /flash/i.test(model) ? 'flash' : 'pro';
}

/** True during Beijing peak hours (09:00–12:00, 14:00–18:00). */
export function isPeakHours(now: Date = new Date()): boolean {
  const beijingHour = new Date(now.getTime() + 8 * 3600 * 1000).getUTCHours();
  return (beijingHour >= 9 && beijingHour < 12) || (beijingHour >= 14 && beijingHour < 18);
}

/** 当前时段中文标签。 */
export function currentRateBand(now: Date = new Date()): 'peak' | 'offpeak' {
  return isPeakHours(now) ? 'peak' : 'offpeak';
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
}

/**
 * Compute DeepSeek cost (RMB) for a token-usage entry.
 * @param applyPeak apply the current 2x peak multiplier. Pass false for
 *   historical aggregates (a consistent off-peak baseline).
 */
export function computeCostRmb(u: TokenUsage, applyPeak = true, now: Date = new Date()): number {
  const rates = OFF_PEAK_RATES[modelTier(u.model)];
  const mult = applyPeak && isPeakHours(now) ? 2 : 1;
  const input = (u.inputTokens || 0) / 1e6 * rates.inputPerM;
  const cacheRead = (u.cacheReadTokens || 0) / 1e6 * rates.cacheHitPerM;
  const cacheWrite = (u.cacheCreationTokens || 0) / 1e6 * rates.inputPerM;
  const output = (u.outputTokens || 0) / 1e6 * rates.outputPerM;
  return (input + cacheRead + cacheWrite + output) * mult;
}

/** Format a RMB amount: 12.30 → "12.3", tiny → up to 4 decimals, trailing zeros stripped. */
export function formatRmb(n: number): string {
  if (!isFinite(n)) return '—';
  const decimals = n >= 10 ? 2 : n >= 1 ? 3 : 4;
  return n.toFixed(decimals).replace(/\.?0+$/, '');
}

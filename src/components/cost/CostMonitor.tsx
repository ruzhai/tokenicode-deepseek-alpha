import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bridge,
  type CostMonitorData,
  type CcusageDailyRow,
  type CcusageSessionRow,
} from '../../lib/tauri-bridge';
import {
  computeCostRmb,
  currentRateBand,
  formatRmb,
  type TokenUsage,
} from '../../lib/deepseek-cost';

const POLL_MS = 5000;

/** 深色终端风配色（btop-like，不随应用主题变化） */
const C = {
  bg: '#0b0e14',
  panel: '#131a26',
  panelBorder: '#1f2937',
  text: '#e6edf3',
  muted: '#8b949e',
  dim: '#5b6672',
  accent: '#2dd4bf',
  good: '#4ade80',
  warn: '#facc15',
  danger: '#f87171',
};

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function usageCostOf(
  row: Pick<CcusageDailyRow, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'modelBreakdowns' | 'modelsUsed'>,
  applyPeak: boolean,
): number {
  if (row.modelBreakdowns?.length) {
    return row.modelBreakdowns.reduce((sum, b) => {
      const u: TokenUsage = {
        inputTokens: b.inputTokens,
        outputTokens: b.outputTokens,
        cacheReadTokens: b.cacheReadTokens,
        cacheCreationTokens: b.cacheCreationTokens,
        model: b.modelName,
      };
      return sum + computeCostRmb(u, applyPeak);
    }, 0);
  }
  return computeCostRmb(
    {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      model: row.modelsUsed?.[0],
    },
    applyPeak,
  );
}

function cacheHitRate(row: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  const total = row.inputTokens + row.cacheReadTokens + row.cacheCreationTokens;
  if (!total) return 0;
  return row.cacheReadTokens / total;
}

/** 简易柱状条 */
function Bar({ fraction, color }: { fraction: number; color: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div style={{ background: C.panelBorder, borderRadius: 3, height: 8, overflow: 'hidden', flex: 1 }}>
      <div
        style={{
          width: `${f * 100}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.6s ease',
        }}
      />
    </div>
  );
}

/** 迷你 sparkline（内联 SVG 折线） */
function Sparkline({ values, width = 300, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', color: C.dim, fontSize: 11 }}>
        数据不足
      </div>
    );
  }
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = height - 3 - ((v - min) / range) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${pts.join(' ')} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polygon points={area} fill={C.accent} opacity={0.12} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={C.accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Stat({
  label,
  value,
  sub,
  bar,
  barColor,
}: {
  label: string;
  value: string;
  sub?: string;
  bar?: number;
  barColor?: string;
}) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 22, fontWeight: 700, color: C.text, marginTop: 2, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
      {bar !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Bar fraction={bar} color={barColor ?? C.accent} />
        </div>
      )}
    </div>
  );
}

export function CostMonitor() {
  const [data, setData] = useState<CostMonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [band, setBand] = useState<'peak' | 'offpeak'>(() => currentRateBand());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const tick = async () => {
      try {
        const d = await bridge.getCostMonitor();
        if (!mounted.current) return;
        if (d.ok) {
          setData(d);
          setError(null);
        } else {
          setError(d.error || '无法读取用量数据');
        }
      } catch (e) {
        if (mounted.current) setError(String(e));
      } finally {
        if (mounted.current) setLastUpdated(new Date());
      }
    };

    tick();
    const t = setInterval(tick, POLL_MS);
    const bandTimer = setInterval(() => setBand(currentRateBand()), 30000);
    return () => {
      mounted.current = false;
      clearInterval(t);
      clearInterval(bandTimer);
    };
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const sessions = [...data.session].sort((a, b) => {
      const ta = a.metadata?.lastActivity ? Date.parse(a.metadata.lastActivity) : 0;
      const tb = b.metadata?.lastActivity ? Date.parse(b.metadata.lastActivity) : 0;
      return tb - ta;
    });
    const current: CcusageSessionRow | null = sessions[0] ?? null;

    const tday = todayStr();
    const today = data.daily.find((d) => d.period === tday) ?? null;

    const todayCost = today ? usageCostOf(today, true) : 0;
    const todayTokens = today?.totalTokens ?? 0;
    const currentCost = current ? usageCostOf(current, true) : 0;
    const hitRate = today ? cacheHitRate(today) : 0;

    const spark = [...data.daily]
      .sort((a, b) => a.period.localeCompare(b.period))
      .slice(-14)
      .map((d) => usageCostOf(d, false));

    const balance = data.balance?.balance_infos?.[0] ?? null;
    const balanceAvailable = data.balance?.is_available ?? false;

    return { sessions, current, today, todayCost, todayTokens, currentCost, hitRate, spark, balance, balanceAvailable };
  }, [data]);

  const isPeak = band === 'peak';

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.panelBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: error ? C.danger : C.good,
              boxShadow: error ? 'none' : `0 0 6px ${C.good}`,
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>API 成本监控</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: isPeak ? 'rgba(250,204,21,0.15)' : 'rgba(74,222,128,0.15)',
              color: isPeak ? C.warn : C.good,
              fontWeight: 600,
            }}
          >
            {isPeak ? '高峰 ×2' : '低谷'}
          </span>
          <span style={{ color: C.dim }}>
            {lastUpdated ? `${lastUpdated.getHours().toString().padStart(2, '0')}:${lastUpdated.getMinutes().toString().padStart(2, '0')}:${lastUpdated.getSeconds().toString().padStart(2, '0')}` : '—'}
          </span>
        </div>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1 }}>
        {error && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: C.danger }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>无法获取用量数据</div>
            <div style={{ color: C.muted, wordBreak: 'break-all' }}>{error}</div>
            <div style={{ color: C.dim, marginTop: 4 }}>
              需要本机已安装 Node.js（用于运行 ccusage），数据仅本地解析，不会上传。
            </div>
          </div>
        )}

        {/* 核心数字 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Stat
            label="本会话花费"
            value={derived ? `¥ ${formatRmb(derived.currentCost)}` : '—'}
            sub={derived?.current ? `${fmtTokens(derived.current.totalTokens)} tokens` : '暂无活动会话'}
            barColor={C.accent}
          />
          <Stat label="今日累计" value={derived ? `¥ ${formatRmb(derived.todayCost)}` : '—'} sub={derived ? `${fmtTokens(derived.todayTokens)} tokens` : ''} barColor={C.warn} />
        </div>

        <Stat
          label="账户余额（DeepSeek 真值）"
          value={derived?.balance ? `¥ ${parseFloat(derived.balance.total_balance).toFixed(2)}` : '—'}
          sub={derived?.balance ? `${derived.balance.currency} · 可用 ${derived.balanceAvailable ? '✓' : '✗'}` : '未配置或无法访问余额接口'}
          barColor={C.good}
        />

        {/* 缓存命中率 */}
        <div style={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, color: C.muted }}>今日缓存命中率</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.text }}>
              {derived ? (derived.hitRate * 100).toFixed(1) + '%' : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
            <Bar fraction={derived?.hitRate ?? 0} color={C.good} />
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
            缓存读 {derived?.today ? fmtTokens(derived.today.cacheReadTokens) : '—'} · 写 {derived?.today ? fmtTokens(derived.today.cacheCreationTokens) : '—'} · 输入 {derived?.today ? fmtTokens(derived.today.inputTokens) : '—'} · 输出 {derived?.today ? fmtTokens(derived.today.outputTokens) : '—'}
          </div>
        </div>

        {/* 近 14 日花费 */}
        <div style={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>近 14 日花费（低谷价基线）</div>
          <Sparkline values={derived?.spark ?? []} width={380} height={44} />
        </div>

        {/* 最近会话 */}
        <div style={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, color: C.muted, padding: '10px 12px 6px' }}>最近会话</div>
          {derived && derived.sessions.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {derived.sessions.slice(0, 8).map((s) => {
                  const cost = usageCostOf(s, true);
                  const when = s.metadata?.lastActivity ? new Date(s.metadata.lastActivity) : null;
                  return (
                    <tr key={s.period} style={{ borderTop: `1px solid ${C.panelBorder}` }}>
                      <td style={{ padding: '6px 12px', fontFamily: 'ui-monospace, monospace', color: C.muted }}>
                        {s.period.slice(0, 8)}
                      </td>
                      <td style={{ padding: '6px 8px', color: C.dim, whiteSpace: 'nowrap' }}>
                        {when ? `${when.getMonth() + 1}/${when.getDate()}` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: C.muted, whiteSpace: 'nowrap' }}>
                        {fmtTokens(s.totalTokens)}
                      </td>
                      <td style={{ padding: '6px 12px 6px 8px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: C.text, whiteSpace: 'nowrap' }}>
                        ¥{formatRmb(cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '10px 12px', color: C.dim, fontSize: 11 }}>暂无会话记录</div>
          )}
        </div>

        <div style={{ fontSize: 10, color: C.dim, padding: '0 2px 6px', lineHeight: 1.5 }}>
          成本按 DeepSeek V4 峰谷价估算（高峰 ×2），缓存写入按输入价计费。余额为 DeepSeek 开放平台真值。
        </div>
      </div>
    </div>
  );
}

export default CostMonitor;

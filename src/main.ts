import './styles.css';

type Panel = 'closed' | 'stocks' | 'holdings' | 'settings' | 'weather' | 'chart';
type ThemeName = FloatDeckSettings['theme'];
type ChartPeriod = KlineSnapshot['period'];
type OverlayIndicator = 'MA' | 'EMA' | 'BOLL';
type SubIndicator = 'VOL' | 'MACD' | 'KDJ' | 'RSI';
type LocationStatus = 'idle' | 'locating' | 'located' | 'failed' | 'manual';
type ChartMode = 'kline' | 'funds' | 'ai';
type FundRange = 20 | 40 | 50;
type AiConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type SettingsSection = 'display' | 'data' | 'ai' | 'alerts';

const INDEX_SECIDS = ['1.000001', '0.399001', '0.399006'];
const THEMES: ThemeName[] = ['glass', 'cozy', 'cyber'];
const FALLBACK_AI_ROLE: AiSystemRole = { id: 'a-share-research', code: 'RESEARCH', name: 'A股投研系统角色', description: '正在同步角色目录' };
const FALLBACK_AI_TASK: AiTaskTemplate = {
  id: 'stock-multifactor', roleId: 'a-share-research', code: 'EQUITY', name: '个股多因子分析', scope: 'stock',
  description: '综合实时行情、K 线、资金趋势与持仓成本', applicability: '适用于当前选中的一只 A 股。',
  toolIds: [], outputSections: [],
};
const queryPanel = new URLSearchParams(location.search).get('panel');
const queryChartMode = new URLSearchParams(location.search).get('mode');
const querySettingsSection = new URLSearchParams(location.search).get('section');
const queryAiHistory = new URLSearchParams(location.search).get('history') === '1';

const SAMPLE_TRENDS: Record<string, number[]> = {
  '1.000001': [3909, 3913, 3908, 3904, 3907, 3901, 3897, 3900, 3892, 3888],
  '0.399001': [14520, 14545, 14511, 14528, 14496, 14482, 14489, 14461],
  '0.399006': [3728, 3734, 3722, 3725, 3719, 3712],
  '0.300750': [352, 354, 353, 357, 356, 355, 358, 355],
  '1.600519': [1211, 1215, 1213, 1218, 1216, 1219],
};

const state: {
  settings: FloatDeckSettings;
  codex: CodexUsage;
  market: Map<string, MarketItem>;
  weather: WeatherData | null;
  panel: Panel;
  loading: Set<string>;
  toast: string | null;
  marketLive: boolean;
  holdingFormOpen: boolean;
  editingHoldingSecid: string | null;
  kline: KlineSnapshot | null;
  chartPeriod: ChartPeriod;
  chartOverlays: Set<OverlayIndicator>;
  chartSubIndicator: SubIndicator;
  locationStatus: LocationStatus;
  locationError: string | null;
  chartMode: ChartMode;
  fundFlow: FundFlowSnapshot | null;
  fundRange: FundRange;
  aiAnalysis: AiAnalysis | null;
  aiError: string | null;
  aiCatalog: AiCatalog;
  aiConnectionStatus: AiConnectionStatus;
  aiConnectionTest: AiConnectionTestResult | null;
  aiConnectionError: string | null;
  aiPendingApiKey: string;
  aiPendingEndpoint: string;
  aiPendingModel: string;
  aiHistory: AiAnalysis[];
  aiHistoryOpen: boolean;
  alertStatus: HoldingAlertStatus;
  settingsSection: SettingsSection;
} = {
  settings: {
    uiVersion: 5,
    city: '上海',
    alwaysOnTop: true,
    allWorkspaces: true,
    opacity: 0.94,
    theme: 'glass',
    weatherAuto: true,
    launchAtLogin: false,
    alertTradingHoursOnly: true,
    alertMaxQuoteAgeSeconds: 180,
    alertPollIntervalSeconds: 60,
    aiEndpoint: 'https://api.openai.com/v1',
    aiModel: 'gpt-5.4',
    aiPrompt: '结论保持简洁，优先指出最关键的机会、风险与需要继续观察的数据。',
    aiHasKey: false,
    aiRoleId: 'a-share-research',
    aiTaskId: 'stock-multifactor',
    selectedSecid: '1.000001',
    watchlist: ['0.300750', '1.600519'],
    holdings: [],
  },
  codex: { connected: false, updatedAt: Date.now() },
  market: new Map(),
  weather: null,
  panel: queryPanel === 'stocks' || queryPanel === 'holdings' || queryPanel === 'settings' || queryPanel === 'weather' || queryPanel === 'chart' ? queryPanel : 'closed',
  loading: new Set(),
  toast: null,
  marketLive: false,
  holdingFormOpen: false,
  editingHoldingSecid: null,
  kline: null,
  chartPeriod: 'day',
  chartOverlays: new Set<OverlayIndicator>(['MA']),
  chartSubIndicator: 'VOL',
  locationStatus: 'idle',
  locationError: null,
  chartMode: queryChartMode === 'funds' || queryChartMode === 'ai' ? queryChartMode : 'kline',
  fundFlow: null,
  fundRange: 40,
  aiAnalysis: null,
  aiError: null,
  aiCatalog: { models: [], roles: [], tasks: [], tools: [] },
  aiConnectionStatus: 'idle',
  aiConnectionTest: null,
  aiConnectionError: null,
  aiPendingApiKey: '',
  aiPendingEndpoint: '',
  aiPendingModel: '',
  aiHistory: [],
  aiHistoryOpen: queryAiHistory,
  alertStatus: { running: false, lastCheckAt: 0, lastSuccessAt: 0, lastError: null, skippedReason: 'starting', enabledCount: 0, freshCount: 0, staleCount: 0, tradingHoursOnly: true, pollIntervalSeconds: 60, maxQuoteAgeSeconds: 180 },
  settingsSection: querySettingsSection === 'data' || querySettingsSection === 'ai' || querySettingsSection === 'alerts' ? querySettingsSection : 'display',
};

const appNode = document.querySelector<HTMLDivElement>('#app')!;
let hasMounted = false;
let lastRenderedPanel: Panel | null = null;

function icon(name: string, size = 16) {
  const paths: Record<string, string> = {
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.08-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.7 3h-4l-.3 3.1a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 3.1h4l.3-3.1a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 0-1Z"/>',
    refresh: '<path d="M19 8a7 7 0 1 0 1 6M19 4v4h-4"/>',
    palette: '<circle cx="8" cy="9" r="2"/><circle cx="15.5" cy="8" r="2"/><circle cx="14" cy="15" r="2"/><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.4-3.4l-.5-.5a2 2 0 0 1 1.4-3.4H19a2 2 0 0 0 2-2A9 9 0 0 0 12 3Z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M5 7h14M9 7l1-3h4l1 3M8 7l1 13h6l1-13M11 11v5M14 11v5"/>',
    chart: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V8"/>',
    pin: '<path d="m9 4 6 6M8 11l-4 4 5 1 1 5 4-4M8 11l5-5 5 5-5 5"/>',
    portfolio: '<path d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7M4 8h16v11H4zM4 12h16M10 12v2h4v-2"/>',
    edit: '<path d="m4 20 4.2-1 10.7-10.7a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20ZM14.7 6.8l2.8 2.8"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7M10 20h4"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    candles: '<path d="M6 3v4m0 7v7M3.5 7h5v7h-5zM17 3v7m0 7v4m-2.5-11h5v7h-5z"/>',
    funds: '<path d="M4 18V8m5 10v-6m5 6V5m5 13V9"/><path d="m3 7 5-3 5 3 7-4"/>',
    ai: '<path d="m12 3 1.5 4.2L18 9l-4.5 1.8L12 15l-1.5-4.2L6 9l4.5-1.8L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 14l.7 1.8L7.5 17l-1.8.7L5 19.5l-.7-1.8L2.5 17l1.8-.7L5 14Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function weatherGlyph(code = 1) {
  if ([95, 96, 99].includes(code)) return `<svg viewBox="0 0 48 48"><path class="cloud" d="M12 31h24a8 8 0 0 0 1-16 12 12 0 0 0-23-1 9 9 0 0 0-2 17Z"/><path class="bolt" d="m23 29-4 9h6l-1 7 8-11h-6l3-5"/></svg>`;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return `<svg viewBox="0 0 48 48"><path class="cloud" d="M12 29h24a8 8 0 0 0 1-16 12 12 0 0 0-23-1 9 9 0 0 0-2 17Z"/><path class="rain" d="m15 34-2 5m10-5-2 5m10-5-2 5"/></svg>`;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return `<svg viewBox="0 0 48 48"><path class="cloud" d="M12 29h24a8 8 0 0 0 1-16 12 12 0 0 0-23-1 9 9 0 0 0-2 17Z"/><path class="snow" d="M15 37h4m-2-2v4m9-2h4m-2-2v4"/></svg>`;
  if ([0, 1].includes(code)) return `<svg viewBox="0 0 48 48"><circle class="sun" cx="24" cy="24" r="8"/><path class="rays" d="M24 7v6m0 22v6M7 24h6m22 0h6M12 12l5 5m14 14 5 5M36 12l-5 5M17 31l-5 5"/></svg>`;
  return `<svg viewBox="0 0 48 48"><circle class="sun muted" cx="18" cy="16" r="7"/><path class="cloud" d="M11 33h26a8 8 0 0 0 0-16 12 12 0 0 0-22-1 9 9 0 0 0-4 17Z"/></svg>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}

function selectedAiRole() {
  return state.aiCatalog.roles.find((role) => role.id === state.settings.aiRoleId) || state.aiCatalog.roles[0] || FALLBACK_AI_ROLE;
}

function aiTasksForRole(roleId = selectedAiRole().id) {
  return state.aiCatalog.tasks.filter((task) => task.roleId === roleId);
}

function selectedAiTask() {
  const role = selectedAiRole();
  return state.aiCatalog.tasks.find((task) => task.id === state.settings.aiTaskId && task.roleId === role.id) || aiTasksForRole(role.id)[0] || FALLBACK_AI_TASK;
}

function aiToolsForTask(task = selectedAiTask()) {
  return task.toolIds.map((id) => state.aiCatalog.tools.find((tool) => tool.id === id)).filter((tool): tool is AiToolDefinition => Boolean(tool));
}

function aiScopeLabel(scope: AiTaskScope) {
  return scope === 'market' ? '大盘 / 自选样本' : scope === 'portfolio' ? '已录入持仓组合' : '当前单只股票';
}

function aiRoleOptions(selectedId = selectedAiRole().id) {
  return state.aiCatalog.roles.map((role) => `<option value="${escapeHtml(role.id)}" ${role.id === selectedId ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('');
}

function aiTaskOptions(roleId = selectedAiRole().id, selectedId: string | undefined = selectedAiTask().id) {
  return aiTasksForRole(roleId).map((task) => `<option value="${escapeHtml(task.id)}" ${task.id === selectedId ? 'selected' : ''}>${escapeHtml(task.name)}</option>`).join('');
}

function aiModelOptions(models: AiAvailableModel[], selectedId: string) {
  const option = (model: AiAvailableModel) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedId ? 'selected' : ''}>${escapeHtml(model.name === model.id ? model.id : `${model.name} · ${model.id}`)}</option>`;
  const chat = models.filter((model) => model.chatCompatible);
  const other = models.filter((model) => !model.chatCompatible);
  return `${chat.length ? `<optgroup label="对话 / 推理模型">${chat.map(option).join('')}</optgroup>` : ''}${other.length ? `<optgroup label="其他可用模型">${other.map(option).join('')}</optgroup>` : ''}`;
}

function updateAiSettingsContractPreview(roleId: string, taskId: string) {
  const role = state.aiCatalog.roles.find((item) => item.id === roleId);
  const task = state.aiCatalog.tasks.find((item) => item.id === taskId && item.roleId === roleId);
  if (!role || !task) return;
  const tools = aiToolsForTask(task);
  const setText = (selector: string, value: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) node.textContent = value;
  };
  setText('#ai-settings-role-code', role.code);
  setText('#ai-settings-role-description', role.description);
  setText('#ai-settings-task-code', task.code);
  setText('#ai-settings-task-description', task.description);
  setText('#ai-settings-scope', aiScopeLabel(task.scope));
  setText('#ai-settings-contract-copy', `${task.outputSections.length} 段固定输出 · ${task.applicability}`);
  const toolNode = document.querySelector<HTMLElement>('#ai-settings-tools');
  if (toolNode) toolNode.innerHTML = tools.map((tool) => `<i title="${escapeHtml(tool.description)}">${escapeHtml(tool.code)}</i>`).join('') || '<i>SYNC</i>';
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function remaining(window?: RateWindow | null) {
  return Math.round(100 - clamp(window?.usedPercent ?? 0));
}

function resetShort(epoch?: number | null) {
  if (!epoch) return 'SYNC';
  const hours = Math.max(0, Math.ceil((epoch * 1000 - Date.now()) / 3_600_000));
  if (hours >= 24) return `${Math.floor(hours / 24)}D ${hours % 24}H`;
  return `${hours}H`;
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoney(value: number, compact = false) {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (compact && absolute >= 10_000) return `${sign}¥${(absolute / 10_000).toFixed(2)}万`;
  return `${sign}¥${absolute.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShares(value: number) {
  return Math.round(value).toLocaleString('zh-CN');
}

function sparkline(points: number[]) {
  const values = points.length > 1 ? points : [1, 1.2, .9, 1.35, 1.1];
  const width = 78;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((point, index) => [
    (index / (values.length - 1)) * width,
    height - 2 - ((point - min) / range) * (height - 5),
  ]);
  const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path class="trend-fill" d="${line} L${width},${height} L0,${height}Z"/><path class="trend-line" d="${line}"/></svg>`;
}

function rollingMean(values: number[], period: number) {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

function exponentialMean(values: number[], period: number) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    previous = index ? value * alpha + previous * (1 - alpha) : value;
    return previous;
  });
}

function rollingDeviation(values: number[], period: number) {
  return values.map((_value, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    const mean = slice.reduce((sum, value) => sum + value, 0) / period;
    return Math.sqrt(slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
  });
}

function linePath(values: Array<number | null>, xAt: (index: number) => number, yAt: (value: number) => number) {
  let drawing = false;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      drawing = false;
      return '';
    }
    const command = drawing ? 'L' : 'M';
    drawing = true;
    return `${command}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`;
  }).join(' ');
}

function calculateKdj(candles: KlineCandle[]) {
  let k = 50;
  let d = 50;
  const result = { k: [] as number[], d: [] as number[], j: [] as number[] };
  candles.forEach((candle, index) => {
    const window = candles.slice(Math.max(0, index - 8), index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const rsv = highest === lowest ? 50 : (candle.close - lowest) / (highest - lowest) * 100;
    k = k * 2 / 3 + rsv / 3;
    d = d * 2 / 3 + k / 3;
    result.k.push(k);
    result.d.push(d);
    result.j.push(3 * k - 2 * d);
  });
  return result;
}

function calculateRsi(values: number[], period: number) {
  return values.map((_value, index) => {
    if (index < period) return null;
    let gains = 0;
    let losses = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const change = values[cursor] - values[cursor - 1];
      if (change >= 0) gains += change;
      else losses -= change;
    }
    return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  });
}

function formatCandleTime(value: string, period: ChartPeriod) {
  if (period === 'm60' && /^\d{12}$/.test(value)) return `${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return period === 'month' ? value.slice(0, 7) : value.slice(5);
  return value;
}

function renderKlineSvg(snapshot: KlineSnapshot) {
  const all = snapshot.candles;
  const limit = snapshot.period === 'month' ? 60 : snapshot.period === 'week' ? 72 : 92;
  const start = Math.max(0, all.length - limit);
  const candles = all.slice(start);
  const closes = all.map((item) => item.close);
  const width = 640;
  const height = 304;
  const left = 11;
  const right = 586;
  const top = 17;
  const mainBottom = 200;
  const subTop = 224;
  const subBottom = 286;
  const plotWidth = right - left;
  const slot = plotWidth / Math.max(1, candles.length);
  const xAt = (index: number) => left + slot * (index + .5);

  const ma5 = rollingMean(closes, 5).slice(start);
  const ma10 = rollingMean(closes, 10).slice(start);
  const ma20 = rollingMean(closes, 20).slice(start);
  const ma60 = rollingMean(closes, 60).slice(start);
  const ema12 = exponentialMean(closes, 12);
  const ema26 = exponentialMean(closes, 26);
  const bollMidAll = rollingMean(closes, 20);
  const deviations = rollingDeviation(closes, 20);
  const bollMid = bollMidAll.slice(start);
  const bollUpper = bollMidAll.map((value, index) => value === null || deviations[index] === null ? null : value + deviations[index]! * 2).slice(start);
  const bollLower = bollMidAll.map((value, index) => value === null || deviations[index] === null ? null : value - deviations[index]! * 2).slice(start);

  const scaleValues = candles.flatMap((item) => [item.high, item.low]);
  if (state.chartOverlays.has('BOLL')) {
    scaleValues.push(...bollUpper.filter((value): value is number => value !== null), ...bollLower.filter((value): value is number => value !== null));
  }
  let priceMin = Math.min(...scaleValues);
  let priceMax = Math.max(...scaleValues);
  const pricePadding = (priceMax - priceMin || Math.max(priceMax * .02, 1)) * .08;
  priceMin -= pricePadding;
  priceMax += pricePadding;
  const yPrice = (value: number) => top + (priceMax - value) / (priceMax - priceMin) * (mainBottom - top);

  const horizontalGrid = Array.from({ length: 5 }, (_item, index) => {
    const ratio = index / 4;
    const y = top + ratio * (mainBottom - top);
    const value = priceMax - ratio * (priceMax - priceMin);
    return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text x="594" y="${y + 2}">${formatPrice(value)}</text>`;
  }).join('');
  const verticalGrid = Array.from({ length: 6 }, (_item, index) => {
    const x = left + index / 5 * plotWidth;
    return `<line x1="${x}" y1="${top}" x2="${x}" y2="${subBottom}"/>`;
  }).join('');
  const timeLabels = Array.from({ length: 5 }, (_item, index) => {
    const candleIndex = Math.min(candles.length - 1, Math.round(index / 4 * (candles.length - 1)));
    return `<text class="time-label" x="${xAt(candleIndex)}" y="301" text-anchor="middle">${formatCandleTime(candles[candleIndex]?.time || '', snapshot.period)}</text>`;
  }).join('');
  const candleWidth = Math.max(1.2, Math.min(6, slot * .64));
  const candleMarkup = candles.map((candle, index) => {
    const rising = candle.close >= candle.open;
    const x = xAt(index);
    const openY = yPrice(candle.open);
    const closeY = yPrice(candle.close);
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(openY - closeY));
    return `<g class="candle ${rising ? 'rise' : 'fall'}"><line x1="${x}" y1="${yPrice(candle.high)}" x2="${x}" y2="${yPrice(candle.low)}"/><rect x="${x - candleWidth / 2}" y="${bodyY}" width="${candleWidth}" height="${bodyHeight}"/></g>`;
  }).join('');

  const overlayPaths: string[] = [];
  if (state.chartOverlays.has('MA')) {
    overlayPaths.push(`<path class="indicator-line ma5" d="${linePath(ma5, xAt, yPrice)}"/><path class="indicator-line ma10" d="${linePath(ma10, xAt, yPrice)}"/><path class="indicator-line ma20" d="${linePath(ma20, xAt, yPrice)}"/><path class="indicator-line ma60" d="${linePath(ma60, xAt, yPrice)}"/>`);
  }
  if (state.chartOverlays.has('EMA')) {
    overlayPaths.push(`<path class="indicator-line ema12" d="${linePath(ema12.slice(start), xAt, yPrice)}"/><path class="indicator-line ema26" d="${linePath(ema26.slice(start), xAt, yPrice)}"/>`);
  }
  if (state.chartOverlays.has('BOLL')) {
    overlayPaths.push(`<path class="indicator-line boll-upper" d="${linePath(bollUpper, xAt, yPrice)}"/><path class="indicator-line boll-mid" d="${linePath(bollMid, xAt, yPrice)}"/><path class="indicator-line boll-lower" d="${linePath(bollLower, xAt, yPrice)}"/>`);
  }

  let subMarkup = '';
  if (state.chartSubIndicator === 'VOL') {
    const maxVolume = Math.max(...candles.map((item) => item.volume), 1);
    subMarkup = candles.map((candle, index) => {
      const barHeight = candle.volume / maxVolume * (subBottom - subTop);
      return `<rect class="volume-bar ${candle.close >= candle.open ? 'rise' : 'fall'}" x="${xAt(index) - candleWidth / 2}" y="${subBottom - barHeight}" width="${candleWidth}" height="${barHeight}"/>`;
    }).join('');
  } else if (state.chartSubIndicator === 'MACD') {
    const difAll = ema12.map((value, index) => value - ema26[index]);
    const deaAll = exponentialMean(difAll, 9);
    const histogram = difAll.map((value, index) => (value - deaAll[index]) * 2).slice(start);
    const dif = difAll.slice(start);
    const dea = deaAll.slice(start);
    const maxAbs = Math.max(...histogram.map(Math.abs), ...dif.map(Math.abs), ...dea.map(Math.abs), .001);
    const midY = (subTop + subBottom) / 2;
    const yMacd = (value: number) => midY - value / maxAbs * (subBottom - subTop) * .46;
    subMarkup = `<line class="zero-line" x1="${left}" y1="${midY}" x2="${right}" y2="${midY}"/>${histogram.map((value, index) => `<rect class="macd-bar ${value >= 0 ? 'rise' : 'fall'}" x="${xAt(index) - candleWidth / 2}" y="${Math.min(midY, yMacd(value))}" width="${candleWidth}" height="${Math.max(.7, Math.abs(yMacd(value) - midY))}"/>`).join('')}<path class="indicator-line dif" d="${linePath(dif, xAt, yMacd)}"/><path class="indicator-line dea" d="${linePath(dea, xAt, yMacd)}"/>`;
  } else if (state.chartSubIndicator === 'KDJ') {
    const kdj = calculateKdj(all);
    const yOscillator = (value: number) => subBottom - clamp(value, -10, 110) / 110 * (subBottom - subTop);
    subMarkup = `<line class="guide-line" x1="${left}" y1="${yOscillator(80)}" x2="${right}" y2="${yOscillator(80)}"/><line class="guide-line" x1="${left}" y1="${yOscillator(20)}" x2="${right}" y2="${yOscillator(20)}"/><path class="indicator-line k-line" d="${linePath(kdj.k.slice(start), xAt, yOscillator)}"/><path class="indicator-line d-line" d="${linePath(kdj.d.slice(start), xAt, yOscillator)}"/><path class="indicator-line j-line" d="${linePath(kdj.j.slice(start), xAt, yOscillator)}"/>`;
  } else {
    const rsi6 = calculateRsi(closes, 6).slice(start);
    const rsi12 = calculateRsi(closes, 12).slice(start);
    const rsi24 = calculateRsi(closes, 24).slice(start);
    const yRsi = (value: number) => subBottom - clamp(value) / 100 * (subBottom - subTop);
    subMarkup = `<line class="guide-line" x1="${left}" y1="${yRsi(70)}" x2="${right}" y2="${yRsi(70)}"/><line class="guide-line" x1="${left}" y1="${yRsi(30)}" x2="${right}" y2="${yRsi(30)}"/><path class="indicator-line rsi6" d="${linePath(rsi6, xAt, yRsi)}"/><path class="indicator-line rsi12" d="${linePath(rsi12, xAt, yRsi)}"/><path class="indicator-line rsi24" d="${linePath(rsi24, xAt, yRsi)}"/>`;
  }

  return `<svg class="kline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" data-start="${start}" data-left="${left}" data-right="${right}" data-count="${candles.length}">
    <defs><clipPath id="main-chart-clip"><rect x="${left}" y="${top}" width="${plotWidth}" height="${mainBottom - top}"/></clipPath><clipPath id="sub-chart-clip"><rect x="${left}" y="${subTop}" width="${plotWidth}" height="${subBottom - subTop}"/></clipPath></defs>
    <g class="chart-grid">${horizontalGrid}${verticalGrid}<line x1="${left}" y1="${subTop}" x2="${right}" y2="${subTop}"/><line x1="${left}" y1="${subBottom}" x2="${right}" y2="${subBottom}"/></g>
    <g clip-path="url(#main-chart-clip)">${candleMarkup}${overlayPaths.join('')}</g>
    <g clip-path="url(#sub-chart-clip)">${subMarkup}</g>
    ${timeLabels}
    <line id="chart-crosshair" class="chart-crosshair" x1="0" y1="${top}" x2="0" y2="${subBottom}" visibility="hidden"/>
  </svg>`;
}

function allSecids() {
  return [...new Set([...INDEX_SECIDS, ...state.settings.watchlist, ...state.settings.holdings.map((holding) => holding.secid)])];
}

function stockRow(secid: string) {
  const item = state.market.get(secid);
  const selected = state.settings.selectedSecid === secid;
  const name = item?.name || secid.split('.')[1];
  return `<button class="stock-option ${selected ? 'selected' : ''}" data-action="select-stock" data-secid="${secid}">
    <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item?.code || secid.split('.')[1])}</small></span>
    <em class="${(item?.percent || 0) >= 0 ? 'up' : 'down'}">${item ? formatPercent(item.percent) : '—'}</em>
    ${selected ? icon('check', 14) : ''}
  </button>`;
}

function renderStockPanel() {
  if (state.panel !== 'stocks') return '';
  return `<section class="drawer stock-drawer">
    <div class="drawer-head"><div><span>DISPLAY SYMBOL</span><strong>选择显示标的</strong></div><button data-action="close-panel" aria-label="收起">${icon('close', 15)}</button></div>
    <div class="stock-scroll">
      <p class="group-label">市场指数</p>
      ${INDEX_SECIDS.map(stockRow).join('')}
      <p class="group-label">我的自选</p>
      ${state.settings.watchlist.length ? state.settings.watchlist.map(stockRow).join('') : '<div class="empty-state">还没有自选股</div>'}
    </div>
    <button class="manage-link" data-action="open-settings">${icon('settings', 13)} 管理自选与主题</button>
  </section>`;
}

function themeCard(theme: ThemeName, title: string, subtitle: string) {
  return `<button class="theme-card theme-preview-${theme} ${state.settings.theme === theme ? 'active' : ''}" data-theme-choice="${theme}">
    <i class="preview-ui"><b></b><b></b><b></b></i>
    <strong>${title}</strong><span>${subtitle}</span>
  </button>`;
}

function renderSettingsPanel() {
  if (state.panel !== 'settings') return '';
  const aiRole = selectedAiRole();
  const aiTask = selectedAiTask();
  const aiTools = aiToolsForTask(aiTask);
  const aiEndpoint = state.aiPendingEndpoint || state.settings.aiEndpoint;
  const aiModel = state.aiPendingModel || state.settings.aiModel;
  const availableModels = state.aiConnectionTest?.models || [];
  const modelControl = availableModels.length
    ? `<select id="ai-model">${aiModelOptions(availableModels, aiModel)}</select>`
    : `<input id="ai-model" value="${escapeHtml(aiModel)}" placeholder="gpt-5.4">`;
  const connectionCopy = state.aiConnectionStatus === 'testing' ? '正在验证接口与 API Key…'
    : state.aiConnectionStatus === 'success' && state.aiConnectionTest ? `连接成功 · ${state.aiConnectionTest.provider} · ${availableModels.length} 个模型`
      : state.aiConnectionStatus === 'error' ? state.aiConnectionError || '连接测试失败'
        : state.settings.aiHasKey ? 'Key 已保存，可重新测试并刷新模型' : '填写 Key 后先测试，再从可用模型中选择';
  const chips = state.settings.watchlist.map((secid) => {
    const item = state.market.get(secid);
    return `<span class="watch-chip">${escapeHtml(item?.name || secid.split('.')[1])}<button data-action="remove-stock" data-secid="${secid}" aria-label="删除">×</button></span>`;
  }).join('');
  const current = state.market.get(state.settings.selectedSecid);
  const alertReason: Record<string, string> = {
    starting: '提醒引擎正在启动',
    'no-enabled-holdings': '没有开启提醒的持仓',
    'outside-trading-hours': '当前休市，已暂停轮询',
    'stale-quotes': '行情已过期，本轮未触发提醒',
    'source-error': '行情源异常，等待下轮重试',
  };
  const alertCopy = state.alertStatus.lastError || (state.alertStatus.skippedReason ? alertReason[state.alertStatus.skippedReason] : `已校验 ${state.alertStatus.freshCount}/${state.alertStatus.enabledCount} 只持仓`);
  const sectionMeta: Record<SettingsSection, [string, string]> = {
    display: ['DISPLAY', '显示与窗口'], data: ['DATA', '行情与天气'], ai: ['AI', '模型与研判'], alerts: ['ALERTS', '提醒可靠性'],
  };
  const displayContent = `<p class="setting-label">主题风格</p>
    <div class="theme-grid">${themeCard('glass', '玻璃', 'FROST')}${themeCard('cozy', '治愈', 'COZY')}${themeCard('cyber', '极客', 'CYBER')}</div>
    <div class="compact-setting"><span><strong>始终置顶</strong><small>停留在窗口最上方</small></span><label class="switch"><input type="checkbox" data-setting="alwaysOnTop" ${state.settings.alwaysOnTop ? 'checked' : ''}><i></i></label></div>
    <div class="compact-setting"><span><strong>跨桌面显示</strong><small>所有 Space 均可见</small></span><label class="switch"><input type="checkbox" data-setting="allWorkspaces" ${state.settings.allWorkspaces ? 'checked' : ''}><i></i></label></div>
    <label class="setting-block"><span>透明度 <b id="opacity-value">${Math.round(state.settings.opacity * 100)}%</b></span><input class="range" type="range" min="76" max="100" value="${Math.round(state.settings.opacity * 100)}" data-setting="opacity"></label>`;
  const dataContent = `<div class="settings-health-card ${state.marketLive ? 'healthy' : 'offline'}"><i></i><span><small>MARKET STATUS</small><strong>${state.marketLive ? `${current?.sourceCount || 1} 个实时源已校验` : '行情源暂不可用'}</strong><em>${current?.timestamp ? `最新行情 ${new Date(current.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待首次同步'}</em></span></div>
    <div class="provider-grid"><span><i>QUOTE</i><b>腾讯 · 东方财富 · 新浪</b><small>多源报价校验</small></span><span><i>KLINE</i><b>腾讯 · 新浪</b><small>双源 K 线降级</small></span><span><i>FLOW</i><b>东方财富</b><small>单源资金趋势</small></span></div>
    <div class="setting-block"><span>天气位置 <small>${state.settings.weatherAuto ? '优先跟随系统定位' : '当前使用手动城市'}</small></span><div class="input-action"><input id="city-input" value="${escapeHtml(state.settings.city)}" placeholder="上海"><button data-action="save-city">应用</button></div><button class="location-retry" data-action="locate-weather">${state.settings.weatherAuto ? '重新获取定位' : '恢复自动定位'}</button></div>
    <div class="setting-block"><span>添加自选股 <small>6 位 A 股代码</small></span><div class="input-action"><input id="stock-input" inputmode="numeric" maxlength="6" placeholder="600036"><button data-action="add-stock">添加</button></div><div class="watch-chips">${chips || '<i>暂无自选</i>'}</div></div>`;
  const aiContent = `<div class="setting-block ai-settings tab-ai-settings">
      <span>AI 研判执行链 <small class="ai-key-status ${state.aiConnectionStatus === 'success' || state.settings.aiHasKey ? 'ready' : ''}">${state.aiConnectionStatus === 'success' && state.aiPendingApiKey ? 'VERIFIED · UNSAVED' : state.settings.aiHasKey ? 'MODEL READY' : 'MODEL UNSET'}</small></span>
      <div class="ai-settings-chain">
        <section class="ai-config-layer model-layer"><b>01</b><div><header><strong>AI 模型配置</strong><small>${state.aiConnectionStatus === 'success' ? 'CONNECTION VERIFIED' : state.settings.aiHasKey ? 'API Key 已加密保存' : 'OpenAI 兼容接口'}</small></header><label><i>接口地址</i><input id="ai-endpoint" value="${escapeHtml(aiEndpoint)}" placeholder="https://api.openai.com/v1"></label><div class="ai-config-grid"><label><i>${availableModels.length ? '可用模型' : '模型（测试后自动获取）'}</i>${modelControl}</label><label><i>API Key</i><input id="ai-api-key" type="password" autocomplete="off" placeholder="${state.aiPendingApiKey ? state.aiConnectionStatus === 'success' ? '新 Key 已验证，等待保存' : '新 Key 待测试' : state.settings.aiHasKey ? '已保存，留空使用当前 Key' : 'sk-…'}"></label></div><div class="ai-connection-check ${state.aiConnectionStatus}"><span><i></i><b>${escapeHtml(connectionCopy)}</b></span><button data-action="test-ai-connection" ${state.aiConnectionStatus === 'testing' ? 'disabled' : ''}>${state.aiConnectionStatus === 'testing' ? '测试中' : availableModels.length ? '刷新模型' : '测试并获取模型'}</button></div></div></section>
        <section class="ai-config-layer"><b>02</b><div><header><strong>研判系统角色</strong><small id="ai-settings-role-code">${escapeHtml(aiRole.code)}</small></header><select id="ai-settings-role" data-ai-select="role" data-ai-context="settings">${aiRoleOptions(aiRole.id)}</select><p id="ai-settings-role-description">${escapeHtml(aiRole.description)}</p></div></section>
        <section class="ai-config-layer"><b>03</b><div><header><strong>研判任务模板</strong><small id="ai-settings-task-code">${escapeHtml(aiTask.code)}</small></header><select id="ai-settings-task" data-ai-select="task" data-ai-context="settings">${aiTaskOptions(aiRole.id, aiTask.id)}</select><p id="ai-settings-task-description">${escapeHtml(aiTask.description)}</p></div></section>
        <section class="ai-config-layer contract-layer"><b>04</b><div><header><strong>执行契约</strong><small id="ai-settings-scope">${escapeHtml(aiScopeLabel(aiTask.scope))}</small></header><div class="ai-settings-tools" id="ai-settings-tools">${aiTools.map((tool) => `<i title="${escapeHtml(tool.description)}">${escapeHtml(tool.code)}</i>`).join('') || '<i>SYNC</i>'}</div><p id="ai-settings-contract-copy">${aiTask.outputSections.length} 段固定输出 · ${escapeHtml(aiTask.applicability)}</p></div></section>
      </div>
      <label class="ai-extra-prompt"><i>附加要求（追加在内置角色与任务之后）</i><textarea id="ai-prompt" rows="3" placeholder="例如：更关注回撤风险，结论控制在 300 字内">${escapeHtml(state.settings.aiPrompt)}</textarea></label>
      <div class="ai-config-actions"><button data-action="save-ai-config">保存整条执行链</button>${state.settings.aiHasKey ? '<button class="secondary" data-action="clear-ai-key">清除 Key</button>' : ''}</div>
    </div>`;
  const alertsContent = `<div class="alert-engine-card ${state.alertStatus.lastError ? 'error' : state.alertStatus.skippedReason ? 'paused' : 'healthy'}"><span class="alert-engine-pulse"><i></i></span><div><small>ALERT ENGINE</small><strong>${state.alertStatus.running ? '提醒引擎运行中' : '提醒引擎未运行'}</strong><p>${escapeHtml(alertCopy)}</p></div><em>${state.alertStatus.lastCheckAt ? new Date(state.alertStatus.lastCheckAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</em></div>
    <div class="compact-setting"><span><strong>登录时自动启动</strong><small>开机登录后在后台保持提醒</small></span><label class="switch"><input type="checkbox" data-setting="launchAtLogin" ${state.settings.launchAtLogin ? 'checked' : ''}><i></i></label></div>
    <div class="compact-setting"><span><strong>仅交易时段轮询</strong><small>休市自动暂停，避免旧行情误报</small></span><label class="switch"><input type="checkbox" data-setting="alertTradingHoursOnly" ${state.settings.alertTradingHoursOnly ? 'checked' : ''}><i></i></label></div>
    <label class="settings-select-row"><span><strong>检查频率</strong><small>提醒引擎轮询间隔</small></span><select data-setting="alertPollIntervalSeconds"><option value="30" ${state.settings.alertPollIntervalSeconds === 30 ? 'selected' : ''}>30 秒</option><option value="60" ${state.settings.alertPollIntervalSeconds === 60 ? 'selected' : ''}>60 秒</option><option value="120" ${state.settings.alertPollIntervalSeconds === 120 ? 'selected' : ''}>120 秒</option></select></label>
    <label class="settings-select-row"><span><strong>行情有效期</strong><small>超过此时长不触发通知</small></span><select data-setting="alertMaxQuoteAgeSeconds"><option value="120" ${state.settings.alertMaxQuoteAgeSeconds === 120 ? 'selected' : ''}>2 分钟</option><option value="180" ${state.settings.alertMaxQuoteAgeSeconds === 180 ? 'selected' : ''}>3 分钟</option><option value="300" ${state.settings.alertMaxQuoteAgeSeconds === 300 ? 'selected' : ''}>5 分钟</option><option value="600" ${state.settings.alertMaxQuoteAgeSeconds === 600 ? 'selected' : ''}>10 分钟</option></select></label>
    <div class="alert-holdings-link"><span><strong>${state.settings.holdings.filter((item) => item.alertEnabled).length} / ${state.settings.holdings.length} 只持仓已开启</strong><small>仍使用每只持仓独立的上涨 / 下跌阈值</small></span><button data-action="open-holdings">管理</button></div>`;
  const contentBySection: Record<SettingsSection, string> = { display: displayContent, data: dataContent, ai: aiContent, alerts: alertsContent };
  const [sectionCode, sectionTitle] = sectionMeta[state.settingsSection];
  return `<section class="drawer settings-drawer">
    <div class="drawer-head"><div><span>SETTINGS / ${sectionCode}</span><strong>设置中心 <small>${sectionTitle}</small></strong></div><button data-action="close-panel" aria-label="收起">${icon('close', 15)}</button></div>
    <nav class="settings-tabs">${(['display', 'data', 'ai', 'alerts'] as SettingsSection[]).map((section) => `<button class="${state.settingsSection === section ? 'active' : ''}" data-settings-section="${section}"><i>${sectionMeta[section][0].slice(0, 2)}</i><span>${sectionMeta[section][1].split('与')[0]}</span></button>`).join('')}</nav>
    <div class="settings-scroll section-${state.settingsSection}">${contentBySection[state.settingsSection]}</div>
  </section>`;
}

function renderHoldingForm() {
  if (!state.holdingFormOpen) return '';
  const editing = state.settings.holdings.find((holding) => holding.secid === state.editingHoldingSecid);
  const code = editing?.secid.split('.')[1] || '';
  return `<form class="holding-form" data-holding-form>
    <div class="holding-form-title"><span><b>${editing ? '编辑持仓' : '新增持仓'}</b><small>提醒按当日涨跌幅触发</small></span><button type="button" data-action="cancel-holding-form">取消</button></div>
    <div class="holding-form-grid">
      <label class="wide"><span>股票代码</span><input id="holding-code" inputmode="numeric" maxlength="6" placeholder="600036" value="${escapeHtml(code)}"></label>
      <label><span>持有股数</span><input id="holding-shares" type="number" min="1" step="1" placeholder="100" value="${editing?.shares ?? ''}"></label>
      <label><span>成本价</span><input id="holding-cost" type="number" min="0.001" step="0.001" placeholder="32.50" value="${editing?.costPrice ?? ''}"></label>
      <label><span class="rise-label">涨幅提醒</span><span class="threshold-input"><input id="holding-alert-up" type="number" min="0.1" max="100" step="0.1" value="${editing?.alertUp ?? 3}"><i>%</i></span></label>
      <label><span class="fall-label">跌幅提醒</span><span class="threshold-input"><input id="holding-alert-down" type="number" min="0.1" max="100" step="0.1" value="${editing?.alertDown ?? 3}"><i>%</i></span></label>
    </div>
    <button class="holding-save" type="submit">${editing ? '保存修改' : '加入持仓并开启提醒'}</button>
  </form>`;
}

function renderHoldingCard(holding: Holding) {
  const item = state.market.get(holding.secid);
  const marketValue = item ? item.price * holding.shares : NaN;
  const costValue = holding.costPrice * holding.shares;
  const profit = item ? marketValue - costValue : NaN;
  const profitPercent = item && costValue > 0 ? profit / costValue * 100 : NaN;
  const positive = Number.isFinite(profit) && profit >= 0;
  return `<article class="holding-card ${holding.alertEnabled ? '' : 'alert-paused'}">
    <div class="holding-card-head">
      <button class="holding-symbol" data-action="select-holding" data-secid="${holding.secid}" title="设为主界面股票">
        <strong>${escapeHtml(item?.name || holding.secid.split('.')[1])}</strong><small>${escapeHtml(item?.code || holding.secid.split('.')[1])}</small>
      </button>
      <span class="holding-day ${(item?.percent || 0) >= 0 ? 'up' : 'down'}">${item ? formatPercent(item.percent) : '同步中'}</span>
    </div>
    <div class="holding-position">
      <span><small>${formatShares(holding.shares)} 股 · 成本 ${formatPrice(holding.costPrice)}</small><strong>${item ? formatMoney(marketValue, true) : '—'}</strong></span>
      <span class="holding-profit ${positive ? 'up' : 'down'}"><small>持仓盈亏</small><strong>${item ? `${profit >= 0 ? '+' : ''}${formatMoney(profit, true)} · ${formatPercent(profitPercent)}` : '—'}</strong></span>
    </div>
    <div class="holding-card-foot">
      <span class="holding-thresholds ${holding.alertEnabled ? '' : 'disabled'}"><i class="rise">↑ ${holding.alertUp}%</i><i class="fall">↓ ${holding.alertDown}%</i></span>
      <span class="holding-actions">
        <button class="${holding.alertEnabled ? 'active' : ''}" data-action="toggle-holding-alert" data-secid="${holding.secid}" title="${holding.alertEnabled ? '暂停提醒' : '开启提醒'}">${icon('bell', 12)}</button>
        <button data-action="edit-holding" data-secid="${holding.secid}" title="编辑持仓">${icon('edit', 12)}</button>
        <button data-action="remove-holding" data-secid="${holding.secid}" title="删除持仓">${icon('trash', 12)}</button>
      </span>
    </div>
  </article>`;
}

function renderHoldingsPanel() {
  if (state.panel !== 'holdings') return '';
  const priced = state.settings.holdings.flatMap((holding) => {
    const item = state.market.get(holding.secid);
    return item ? [{ holding, item }] : [];
  });
  const totalValue = priced.reduce((sum, { holding, item }) => sum + holding.shares * item.price, 0);
  const totalCost = priced.reduce((sum, { holding }) => sum + holding.shares * holding.costPrice, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? totalProfit / totalCost * 100 : 0;
  const loaded = !state.settings.holdings.length || priced.length > 0;
  return `<section class="drawer holdings-drawer">
    <div class="drawer-head"><div><span>PORTFOLIO ALERTS</span><strong>我的持仓</strong></div><div class="drawer-head-actions"><button data-action="new-holding" aria-label="新增持仓" title="新增持仓">${icon('plus', 14)}</button><button data-action="close-panel" aria-label="收起">${icon('close', 15)}</button></div></div>
    <div class="holding-scroll">
      <div class="portfolio-summary">
        <span><small>总市值</small><strong>${loaded ? formatMoney(totalValue, true) : '同步中'}</strong></span>
        <span class="${totalProfit >= 0 ? 'up' : 'down'}"><small>总盈亏</small><strong>${loaded ? `${totalProfit >= 0 ? '+' : ''}${formatMoney(totalProfit, true)}` : '—'}</strong><i>${priced.length ? formatPercent(totalProfitPercent) : '—'}</i></span>
        <em>${state.settings.holdings.length} 只</em>
      </div>
      ${renderHoldingForm()}
      <div class="holdings-list">
        ${state.settings.holdings.length ? state.settings.holdings.map(renderHoldingCard).join('') : `<div class="empty-holdings">${icon('portfolio', 25)}<strong>还没有持仓</strong><span>记录成本与股数，并按涨跌幅提醒</span><button data-action="new-holding">添加第一只</button></div>`}
      </div>
    </div>
  </section>`;
}

function forecastDayLabel(date: string, index: number) {
  if (index === 0) return '今天';
  if (index === 1) return '明天';
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
}

function renderWeatherPanel() {
  if (state.panel !== 'weather') return '';
  const weather = state.weather;
  const statusText = state.locationStatus === 'locating' ? '正在获取系统定位…'
    : state.locationStatus === 'located' ? '已跟随当前位置'
      : state.locationStatus === 'failed' ? '定位不可用，使用手动城市'
        : state.settings.weatherAuto ? '自动定位天气' : '手动城市天气';
  const showManual = state.locationStatus === 'failed' || !state.settings.weatherAuto;
  return `<section class="drawer weather-drawer">
    <div class="drawer-head"><div><span>7 DAY FORECAST</span><strong>未来七日天气</strong></div><button data-action="close-panel" aria-label="收起">${icon('close', 15)}</button></div>
    <div class="weather-panel-scroll">
      <div class="location-status ${state.locationStatus}">
        <span><i></i><b>${escapeHtml(statusText)}</b><small>${escapeHtml(weather?.source === 'location' ? '当前位置' : weather?.city || state.settings.city)}</small></span>
        <button data-action="locate-weather">重新定位</button>
      </div>
      ${showManual ? `<div class="weather-manual"><input id="weather-city-input" value="${escapeHtml(state.settings.city)}" placeholder="输入城市，如：杭州"><button data-action="save-weather-city">查看</button></div>` : ''}
      <div class="forecast-list">
        ${weather?.daily?.length ? weather.daily.slice(0, 7).map((day, index) => `<article class="forecast-day ${index === 0 ? 'today' : ''}">
          <span class="forecast-date"><strong>${forecastDayLabel(day.date, index)}</strong><small>${day.date.slice(5).replace('-', '/')}</small></span>
          <span class="forecast-icon">${weatherGlyph(day.code)}</span>
          <span class="forecast-condition"><strong>${escapeHtml(day.condition)}</strong><small>降水 ${day.rain}%</small></span>
          <span class="forecast-temp"><strong>${day.high}°</strong><small>${day.low}°</small></span>
        </article>`).join('') : '<div class="weather-panel-loading">正在同步未来七日天气…</div>'}
      </div>
    </div>
  </section>`;
}

function indicatorButton(name: OverlayIndicator | SubIndicator, kind: 'overlay' | 'sub') {
  const active = kind === 'overlay' ? state.chartOverlays.has(name as OverlayIndicator) : state.chartSubIndicator === name;
  return `<button class="${active ? 'active' : ''}" data-indicator="${name}" data-indicator-kind="${kind}">${name}</button>`;
}

function chartSourceBadge(sources: string[] | undefined, fallback = '行情同步') {
  const available = sources?.filter(Boolean) || [];
  return `<span class="data-source-badge"><i></i>${escapeHtml(available.length ? `${available.length} 源 · ${available.join(' / ')}` : fallback)}</span>`;
}

function renderKlineWorkspace(current?: MarketItem) {
  const snapshot = state.kline?.secid === state.settings.selectedSecid && state.kline.period === state.chartPeriod ? state.kline : null;
  const latest = snapshot?.candles.at(-1);
  const previous = snapshot?.candles.at(-2);
  const change = latest && previous ? (latest.close - previous.close) / previous.close * 100 : current?.percent || 0;
  const periods: Array<[ChartPeriod, string]> = [['m60', '60分'], ['day', '日K'], ['week', '周K'], ['month', '月K']];
  return `<div class="chart-workspace">
      <div class="chart-meta">
        <span class="chart-last ${change >= 0 ? 'up' : 'down'}"><strong>${latest ? formatPrice(latest.close) : current ? formatPrice(current.price) : '—'}</strong><small>${formatPercent(change)}</small></span>
        <span class="ohlc"><i>开 <b>${latest ? formatPrice(latest.open) : '—'}</b></i><i>高 <b>${latest ? formatPrice(latest.high) : '—'}</b></i><i>低 <b>${latest ? formatPrice(latest.low) : '—'}</b></i><i>收 <b>${latest ? formatPrice(latest.close) : '—'}</b></i></span>
        <span class="chart-period-box">${chartSourceBadge(snapshot?.sources, current?.sourceCount ? `${current.sourceCount} 源实时校验` : '行情同步')}<span class="chart-periods">${periods.map(([period, label]) => `<button class="${state.chartPeriod === period ? 'active' : ''}" data-chart-period="${period}">${label}</button>`).join('')}</span></span>
      </div>
      <div class="indicator-toolbar">
        <span><i>主图</i>${indicatorButton('MA', 'overlay')}${indicatorButton('EMA', 'overlay')}${indicatorButton('BOLL', 'overlay')}</span>
        <span><i>副图</i>${indicatorButton('VOL', 'sub')}${indicatorButton('MACD', 'sub')}${indicatorButton('KDJ', 'sub')}${indicatorButton('RSI', 'sub')}</span>
      </div>
      <div class="chart-stage ${state.loading.has('kline') ? 'loading' : ''}">
        ${snapshot ? renderKlineSvg(snapshot) : `<div class="chart-loading"><i></i><strong>${state.loading.has('kline') ? '正在加载 K 线' : '暂无 K 线数据'}</strong><span>行情同步后将在这里绘制</span></div>`}
        <div id="kline-tooltip" class="kline-tooltip"></div>
      </div>
    </div>`;
}

function formatFundMoney(value: number, includeSign = true) {
  if (!Number.isFinite(value)) return '—';
  const sign = includeSign && value > 0 ? '+' : value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toFixed(2)}亿`;
  if (absolute >= 10_000) return `${sign}${(absolute / 10_000).toFixed(1)}万`;
  return `${sign}${absolute.toFixed(0)}`;
}

function renderFundFlowSvg(snapshot: FundFlowSnapshot) {
  const points = snapshot.daily.slice(-state.fundRange);
  const width = 640;
  const height = 280;
  const left = 48;
  const right = 586;
  const top = 18;
  const mainBottom = 176;
  const cumulativeTop = 207;
  const cumulativeBottom = 258;
  const plotWidth = right - left;
  const mainHeight = mainBottom - top;
  const cumulativeHeight = cumulativeBottom - cumulativeTop;
  const xAt = (index: number) => left + (index + .5) / Math.max(1, points.length) * plotWidth;
  const slot = plotWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(10, slot * .62));
  const fundMax = Math.max(...points.flatMap((point) => [Math.abs(point.main), Math.abs(point.net)]), 1) * 1.12;
  const fundZero = top + mainHeight / 2;
  const yFund = (value: number) => fundZero - value / fundMax * mainHeight * .47;
  const prices = points.map((point) => point.price);
  const rawPriceMin = Math.min(...prices);
  const rawPriceMax = Math.max(...prices);
  const pricePadding = Math.max((rawPriceMax - rawPriceMin) * .12, rawPriceMax * .012, .01);
  const priceMin = rawPriceMin - pricePadding;
  const priceMax = rawPriceMax + pricePadding;
  const yPrice = (value: number) => top + (priceMax - value) / Math.max(priceMax - priceMin, .001) * mainHeight;
  let running = 0;
  const cumulative = points.map((point) => (running += point.net));
  const cumulativeMax = Math.max(...cumulative.map(Math.abs), 1) * 1.08;
  const cumulativeZero = cumulativeTop + cumulativeHeight / 2;
  const yCumulative = (value: number) => cumulativeZero - value / cumulativeMax * cumulativeHeight * .47;
  const topGrid = [1, .5, 0, -.5, -1].map((ratio) => {
    const y = yFund(fundMax * ratio);
    const price = priceMax - (y - top) / mainHeight * (priceMax - priceMin);
    return `<line class="${ratio === 0 ? 'fund-zero' : ''}" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="fund-axis-left" x="42" y="${y + 2}" text-anchor="end">${formatFundMoney(fundMax * ratio)}</text><text class="fund-axis-right" x="594" y="${y + 2}">${price.toFixed(2)}</text>`;
  }).join('');
  const bottomGrid = [1, 0, -1].map((ratio) => {
    const y = yCumulative(cumulativeMax * ratio);
    return `<line class="${ratio === 0 ? 'fund-zero' : ''}" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="fund-axis-left" x="42" y="${y + 2}" text-anchor="end">${formatFundMoney(cumulativeMax * ratio)}</text>`;
  }).join('');
  const verticalGrid = Array.from({ length: 6 }, (_item, index) => {
    const x = left + index / 5 * plotWidth;
    return `<line x1="${x}" y1="${top}" x2="${x}" y2="${mainBottom}"/>`;
  }).join('');
  const dateLabels = Array.from({ length: 6 }, (_item, index) => {
    const pointIndex = Math.min(points.length - 1, Math.round(index / 5 * (points.length - 1)));
    return `<text class="time-label" x="${xAt(pointIndex)}" y="196" text-anchor="middle">${escapeHtml(points[pointIndex]?.date?.slice(5) || '')}</text>`;
  }).join('');
  const mainBars = points.map((point, index) => {
    const y = yFund(point.main);
    return `<rect class="daily-main-bar ${point.main >= 0 ? 'rise' : 'fall'}" x="${xAt(index) - barWidth / 2}" y="${Math.min(fundZero, y)}" width="${barWidth}" height="${Math.max(.7, Math.abs(fundZero - y))}"/>`;
  }).join('');
  const cumulativeBars = cumulative.map((value, index) => {
    const y = yCumulative(value);
    return `<rect class="cumulative-bar ${value >= 0 ? 'rise' : 'fall'}" x="${xAt(index) - barWidth / 2}" y="${Math.min(cumulativeZero, y)}" width="${barWidth}" height="${Math.max(.7, Math.abs(cumulativeZero - y))}"/>`;
  }).join('');
  const netPath = linePath(points.map((point) => point.net), xAt, yFund);
  const pricePath = linePath(prices, xAt, yPrice);
  const latest = points.at(-1);
  const latestIndex = points.length - 1;
  return `<svg class="fund-svg daily-fund-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><clipPath id="fund-main-clip"><rect x="${left}" y="${top}" width="${plotWidth}" height="${mainHeight}"/></clipPath><clipPath id="fund-cumulative-clip"><rect x="${left}" y="${cumulativeTop}" width="${plotWidth}" height="${cumulativeHeight}"/></clipPath></defs>
    <g class="chart-grid fund-grid">${topGrid}${bottomGrid}${verticalGrid}</g>
    <text class="fund-axis-title" x="${left}" y="9">资金净流入</text><text class="fund-axis-title right" x="${right}" y="9" text-anchor="end">股价</text><text class="fund-axis-title" x="${left}" y="204">区间累计净流入</text>
    <g clip-path="url(#fund-main-clip)">${mainBars}<path class="fund-path fund-daily-net" d="${netPath}"/><path class="fund-path fund-price" d="${pricePath}"/></g>
    <g clip-path="url(#fund-cumulative-clip)">${cumulativeBars}</g>
    ${latest ? `<circle class="fund-latest-dot net" cx="${xAt(latestIndex)}" cy="${yFund(latest.net)}" r="2.6"/><circle class="fund-latest-dot price" cx="${xAt(latestIndex)}" cy="${yPrice(latest.price)}" r="2.6"/>` : ''}
    ${dateLabels}
  </svg>`;
}

function renderFundWorkspace(current?: MarketItem) {
  const snapshot = state.fundFlow?.secid === state.settings.selectedSecid ? state.fundFlow : null;
  const rangePoints = snapshot?.daily.slice(-state.fundRange) || [];
  const latest = rangePoints.at(-1);
  const main = latest?.main || snapshot?.points.at(-1)?.main || 0;
  const cumulative = rangePoints.reduce((sum, point) => sum + point.net, 0);
  return `<div class="fund-workspace">
    <div class="fund-summary">
      <span class="fund-primary ${main >= 0 ? 'up' : 'down'}"><small>主力当日净流入</small><strong>${latest ? formatFundMoney(main) : '—'}</strong><i>${latest?.date || '日级趋势'}</i></span>
      <span><small>当日净流入</small><strong class="${(latest?.net || 0) >= 0 ? 'up' : 'down'}">${latest ? formatFundMoney(latest.net) : '—'}</strong></span>
      <span><small>${state.fundRange} 日累计</small><strong class="${cumulative >= 0 ? 'up' : 'down'}">${latest ? formatFundMoney(cumulative) : '—'}</strong></span>
      <span><small>收盘 / 现价</small><strong>${latest ? formatPrice(latest.price) : current ? formatPrice(current.price) : '—'}</strong></span>
      <span><small>超大单</small><strong class="${(latest?.superLarge || 0) >= 0 ? 'up' : 'down'}">${latest ? formatFundMoney(latest.superLarge) : '—'}</strong></span>
      <span class="fund-quote"><small>${escapeHtml(current?.name || snapshot?.name || '当前标的')}</small><strong>${current ? formatPercent(current.percent) : '—'}</strong>${chartSourceBadge(snapshot ? [snapshot.source] : undefined, '资金源同步')}</span>
    </div>
    <div class="fund-toolbar"><span class="fund-legend"><i class="net"></i>当日净流入<i class="main"></i>主力当日净流入<i class="cumulative"></i>累计净流入<i class="price"></i>股价</span><span class="fund-ranges">${([20, 40, 50] as FundRange[]).map((range) => `<button class="${state.fundRange === range ? 'active' : ''}" data-fund-range="${range}">${range}日</button>`).join('')}</span></div>
    <div class="fund-stage ${state.loading.has('fund-flow') ? 'loading' : ''}">${snapshot?.daily.length ? renderFundFlowSvg(snapshot) : `<div class="chart-loading"><i></i><strong>${state.loading.has('fund-flow') ? '正在加载资金趋势' : '暂无日级资金数据'}</strong><span>同步最近 90 个交易日的资金与股价</span></div>`}</div>
  </div>`;
}

function selectedAiAnalysis() {
  const analysis = state.aiAnalysis;
  const task = selectedAiTask();
  const role = selectedAiRole();
  if (!analysis || analysis.taskId !== task.id || analysis.roleId !== role.id) return null;
  if (task.scope === 'stock' && analysis.secid !== state.settings.selectedSecid) return null;
  return analysis;
}

function analysisToMarkdown(analysis: AiAnalysis) {
  const stamp = new Date(analysis.updatedAt).toLocaleString('zh-CN', { hour12: false });
  return `# ${analysis.title} · ${analysis.taskName}\n\n- 系统角色：${analysis.roleName}\n- 模型：${analysis.model}\n- 时间：${stamp}\n- 工具：${analysis.toolIds.join('、')}\n\n${analysis.content}`;
}

function renderAiHistoryPanel() {
  if (!state.aiHistoryOpen) return '';
  return `<aside class="ai-history-panel">
    <header><span><small>LOCAL ARCHIVE</small><strong>研判历史</strong></span>${state.aiHistory.length ? `<button data-action="clear-ai-history">清空</button>` : ''}</header>
    <div class="ai-history-list">${state.aiHistory.length ? state.aiHistory.map((analysis) => `<article class="ai-history-item ${state.aiAnalysis?.id === analysis.id ? 'active' : ''}"><button class="history-main" data-action="open-ai-history" data-history-id="${escapeHtml(analysis.id)}"><span><strong>${escapeHtml(analysis.title || analysis.taskName)}</strong><small>${escapeHtml(analysis.taskName)}</small></span><em>${new Date(analysis.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</em></button><button class="history-remove" data-action="remove-ai-history" data-history-id="${escapeHtml(analysis.id)}" title="删除">×</button></article>`).join('') : '<div class="ai-history-empty">完成一次研判后，报告会自动保存在本机。</div>'}</div>
    <footer><span>本机最多保留 30 条</span><button data-action="toggle-ai-history">收起</button></footer>
  </aside>`;
}

function renderAiContent(body: string) {
  return `<div class="ai-content-shell ${state.aiHistoryOpen ? 'history-open' : ''}">${body}${renderAiHistoryPanel()}</div>`;
}

function renderAiDecisionChain() {
  const role = selectedAiRole();
  const task = selectedAiTask();
  const model = state.aiCatalog.models[0];
  const tools = aiToolsForTask(task);
  return `<div class="ai-decision-chain">
    <div class="ai-chain-row">
      <button class="ai-chain-node model ${model?.configured || state.settings.aiHasKey ? 'ready' : ''}" data-action="open-settings" data-settings-target="ai"><i>01</i><span><small>AI MODEL</small><strong>${escapeHtml(model?.model || state.settings.aiModel)}</strong><em>${model?.configured || state.settings.aiHasKey ? '已连接' : '待配置'}</em></span></button>
      <label class="ai-chain-node"><i>02</i><span><small>SYSTEM ROLE</small><select data-ai-select="role" data-ai-context="workspace" aria-label="研判系统角色">${aiRoleOptions(role.id)}</select><em>${escapeHtml(role.code)}</em></span></label>
      <label class="ai-chain-node task"><i>03</i><span><small>TASK TEMPLATE</small><select data-ai-select="task" data-ai-context="workspace" aria-label="研判任务模板">${aiTaskOptions(role.id, task.id)}</select><em>${escapeHtml(task.description)}</em></span></label>
    </div>
    <div class="ai-contract-strip">
      <i>04</i><span class="contract-scope"><small>适用范围</small><strong>${escapeHtml(aiScopeLabel(task.scope))}</strong></span>
      <span class="contract-tools"><small>所需工具 · ${tools.length}</small><b>${tools.map((tool) => `<em title="${escapeHtml(tool.description)}">${escapeHtml(tool.code)}</em>`).join('') || '<em>SYNC</em>'}</b></span>
      <span class="contract-output"><small>输出结构 · ${task.outputSections.length}</small><strong>${escapeHtml(task.outputSections.slice(0, 3).join(' / ') || '同步目录')}</strong></span>
      <button class="ai-history-trigger ${state.aiHistoryOpen ? 'active' : ''}" data-action="toggle-ai-history" title="研判历史">${icon('history', 11)}<span>历史</span><b>${state.aiHistory.length}</b></button>
    </div>
  </div>`;
}

function renderAiWorkspace(current?: MarketItem) {
  const role = selectedAiRole();
  const task = selectedAiTask();
  const tools = aiToolsForTask(task);
  const analysis = selectedAiAnalysis();
  const chain = renderAiDecisionChain();
  const unavailable = task.scope === 'portfolio' && !state.settings.holdings.length;
  let body: string;
  if (state.loading.has('ai-analysis')) body = `<div class="ai-pane ai-loading"><span class="ai-orbit">${icon('ai', 29)}</span><strong>正在执行「${escapeHtml(task.name)}」</strong><small>${escapeHtml(tools.map((tool) => tool.name).join(' · '))}</small></div>`;
  else if (state.aiError) body = `<div class="ai-pane ai-empty"><span class="agent-empty-mark">${escapeHtml(task.code)}</span><strong>研判任务未完成</strong><p>${escapeHtml(state.aiError)}</p><div><button data-action="run-ai-agent">重新运行</button><button class="secondary" data-action="open-settings" data-settings-target="ai">检查模型配置</button></div></div>`;
  else if (!analysis) body = `<div class="ai-pane ai-empty"><span class="agent-empty-mark">${escapeHtml(task.code)}</span><strong>${unavailable ? '当前任务还缺少持仓数据' : `运行「${escapeHtml(task.name)}」`}</strong><p>${unavailable ? '先录入至少一只持仓，任务会自动计算组合权重、盈亏贡献和高权重信号。' : `${escapeHtml(task.description)}。${task.scope === 'stock' ? ` 当前标的：${escapeHtml(current?.name || state.settings.selectedSecid.split('.')[1])}。` : ''}`}</p><div><button data-action="${unavailable ? 'open-holdings' : 'run-ai-agent'}">${unavailable ? '录入持仓' : '开始研判'}</button><button class="secondary" data-action="open-settings" data-settings-target="ai">配置执行链</button></div></div>`;
  else {
  const reportTitle = analysis.title === task.name ? task.name : `${analysis.title} · ${task.name}`;
    body = `<div class="ai-pane ai-result">
    <div class="ai-report-head"><span><i>${icon('ai', 13)}</i><b>${escapeHtml(reportTitle)}</b><small>${escapeHtml(analysis.model)} · ${new Date(analysis.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></span><div class="ai-report-actions"><button class="secondary" data-action="copy-ai-report">${icon('copy', 10)} 复制</button><button data-action="run-ai-agent">重新研判</button></div></div>
    <article class="ai-report">${escapeHtml(analysis.content)}</article>
    <footer><span>${escapeHtml(role.name)} · ${analysis.toolIds.length} 个工具 · ${analysis.outputSections.length} 段输出</span><button data-action="open-settings" data-settings-target="ai">调整执行链</button></footer>
  </div>`;
  }
  return `<div class="ai-workspace">${chain}${renderAiContent(body)}</div>`;
}

function renderChartPanel() {
  if (state.panel !== 'chart') return '';
  const current = state.market.get(state.settings.selectedSecid);
  const modeLabels: Record<ChartMode, [string, string]> = {
    kline: ['KLINE WORKSPACE', 'K 线与技术指标'],
    funds: ['CAPITAL FLOW', '当日资金趋势'],
    ai: ['AI DECISION CHAIN', '角色 · 任务 · 工具契约'],
  };
  const [eyebrow, title] = modeLabels[state.chartMode];
  const headerName = state.chartMode === 'ai' ? selectedAiTask().name : current?.name || state.settings.selectedSecid.split('.')[1];
  const headerCode = state.chartMode === 'ai' ? selectedAiRole().code : current?.code || state.settings.selectedSecid.split('.')[1];
  return `<section class="drawer chart-drawer mode-${state.chartMode}">
    <div class="drawer-head chart-head"><div><span>${eyebrow}</span><strong>${escapeHtml(headerName)} <small>${escapeHtml(headerCode)} · ${title}</small></strong></div><div class="drawer-head-actions chart-mode-actions"><button class="${state.chartMode === 'kline' ? 'active' : ''}" data-action="show-kline" aria-label="K 线" title="K 线与指标">${icon('candles', 14)}</button><button class="${state.chartMode === 'funds' ? 'active' : ''}" data-action="show-funds" aria-label="资金趋势" title="资金流入流出">${icon('funds', 14)}</button><button class="${state.chartMode === 'ai' ? 'active' : ''}" data-action="show-ai" aria-label="AI 研判" title="AI 研判">${icon('ai', 14)}</button><button data-action="close-panel" aria-label="收起">${icon('close', 15)}</button></div></div>
    ${state.chartMode === 'kline' ? renderKlineWorkspace(current) : state.chartMode === 'funds' ? renderFundWorkspace(current) : renderAiWorkspace(current)}
  </section>`;
}

function renderCore() {
  const current = state.market.get(state.settings.selectedSecid);
  const primary = state.codex.primary;
  const remain = remaining(primary);
  const up = (current?.percent || 0) >= 0;
  const weather = state.weather;
  return `<header class="micro-header">
      <div class="brand"><b>GLANCE</b><span>瞬览</span></div>
      <div class="header-actions">
        <button class="theme-switch" data-action="cycle-theme" aria-label="切换主题" title="切换主题"><span class="theme-dots"><i></i><i></i><i></i></span></button>
        <button data-action="open-stocks" aria-label="切换股票" title="切换股票">${icon('chart', 12)}</button>
        <button data-action="open-holdings" aria-label="我的持仓" title="我的持仓">${icon('portfolio', 12)}</button>
        <button class="pin-button ${state.settings.alwaysOnTop ? 'active' : ''}" data-action="toggle-pin" aria-label="切换置顶" title="始终置顶">${icon('pin', 12)}</button>
        <button data-action="refresh" class="${state.loading.size ? 'spinning' : ''}" aria-label="刷新" title="刷新数据">${icon('refresh', 12)}</button>
        <button data-action="open-settings" aria-label="设置" title="设置">${icon('settings', 12)}</button>
        <button data-action="hide" aria-label="隐藏" title="隐藏">${icon('close', 12)}</button>
      </div>
    </header>
    <section class="codex-strip">
      <div class="codex-glyph"><span>&gt;</span><b>_</b></div>
      <div class="usage-label"><strong>CODEX</strong><span>${state.codex.connected ? resetShort(primary?.resetsAt) : 'LOCAL'}</span></div>
      <div class="usage-track"><i style="--progress:${state.codex.connected ? clamp(remain) : 0}%"></i></div>
      <div class="usage-value"><strong>${state.codex.connected ? remain : '—'}</strong><span>%</span></div>
    </section>
    <section class="focus-ticker ${up ? 'is-up' : 'is-down'}">
      <button class="ticker-zone stock-identity" data-action="open-stocks" aria-label="切换股票"><strong>${escapeHtml(current?.name || '加载行情')}</strong><small>${escapeHtml(current?.code || state.settings.selectedSecid.split('.')[1])}</small></button>
      <button class="ticker-zone trend-graph" data-action="open-chart" aria-label="打开 K 线" title="查看 K 线与指标">${sparkline(current?.trend || [])}</button>
      <button class="ticker-zone stock-quote" data-action="open-stocks" aria-label="切换股票"><strong>${current ? formatPrice(current.price) : '—'}</strong><small>${current ? formatPercent(current.percent) : '同步中'}</small></button>
      <button class="ticker-zone open-arrow" data-action="open-stocks" aria-label="切换股票">${icon('chevron', 13)}</button>
    </section>
    <footer class="weather-strip">
      <button class="weather-mini" data-action="open-weather" aria-label="查看未来七日天气" title="未来七日天气">${weatherGlyph(weather?.code || 2)}</button>
      <strong>${weather ? `${weather.temperature}°` : '—°'}</strong>
      <span class="place">${escapeHtml(weather?.city || state.settings.city)}</span>
      <span class="condition">${escapeHtml(weather?.condition || '同步天气')}</span>
      <i class="source-dot ${state.marketLive ? '' : 'offline'}" title="${state.marketLive ? escapeHtml(`${current?.sourceCount || 1} 个实时行情源已校验`) : '行情源暂不可用'}"></i>
      <button data-action="open-settings" aria-label="打开设置">${icon('settings', 14)}</button>
    </footer>`;
}

function render() {
  const initialMount = !hasMounted;
  const panelChanged = lastRenderedPanel !== null && lastRenderedPanel !== state.panel;
  document.body.dataset.theme = state.settings.theme;
  document.body.dataset.panel = state.panel;
  appNode.innerHTML = `<main class="widget-shell panel-${state.panel} ${initialMount ? 'initial-mount' : ''} ${panelChanged ? 'panel-transition' : ''}">
    <div class="ambient one"></div><div class="ambient two"></div>
    <div class="core">${renderCore()}</div>
    ${renderStockPanel()}
    ${renderHoldingsPanel()}
    ${renderSettingsPanel()}
    ${renderWeatherPanel()}
    ${renderChartPanel()}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  </main>`;
  hasMounted = true;
  lastRenderedPanel = state.panel;
  bindEvents();
  bindChartHover();
}

function secidFromCode(code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const market = /^(4|8|92)/.test(code) ? '2' : /^(5|6)/.test(code) ? '1' : '0';
  return `${market}.${code}`;
}

async function setPanel(panel: Panel) {
  state.panel = panel;
  render();
  await window.floatdeck.resizePanel(panel);
}

async function saveSettings(patch: Partial<FloatDeckSettings>, rerender = true) {
  state.settings = { ...state.settings, ...patch };
  if (rerender) render();
  state.settings = await window.floatdeck.saveSettings(patch);
}

function showToast(message: string) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    if (state.toast !== message) return;
    state.toast = null;
    render();
  }, 1800);
}

function cycleTheme() {
  const index = THEMES.indexOf(state.settings.theme);
  saveSettings({ theme: THEMES[(index + 1) % THEMES.length] });
}

async function saveHoldingFromForm() {
  const code = document.querySelector<HTMLInputElement>('#holding-code')?.value.trim() || '';
  const shares = Math.round(Number(document.querySelector<HTMLInputElement>('#holding-shares')?.value));
  const costPrice = Number(document.querySelector<HTMLInputElement>('#holding-cost')?.value);
  const alertUp = Number(document.querySelector<HTMLInputElement>('#holding-alert-up')?.value);
  const alertDown = Number(document.querySelector<HTMLInputElement>('#holding-alert-down')?.value);
  const secid = secidFromCode(code);
  if (!secid) return showToast('请输入正确的 6 位股票代码');
  if (!Number.isFinite(shares) || shares <= 0) return showToast('持有股数需要大于 0');
  if (!Number.isFinite(costPrice) || costPrice <= 0) return showToast('请输入正确的成本价');
  if (!Number.isFinite(alertUp) || alertUp < 0.1 || alertUp > 100) return showToast('上涨阈值需在 0.1%–100%');
  if (!Number.isFinite(alertDown) || alertDown < 0.1 || alertDown > 100) return showToast('下跌阈值需在 0.1%–100%');

  const duplicate = state.settings.holdings.some((holding) => holding.secid === secid && holding.secid !== state.editingHoldingSecid);
  if (duplicate) return showToast('这只股票已经在持仓里');
  if (!state.editingHoldingSecid && state.settings.holdings.length >= 12) return showToast('最多记录 12 只持仓');

  const previous = state.settings.holdings.find((holding) => holding.secid === state.editingHoldingSecid);
  const next: Holding = { secid, shares, costPrice, alertUp, alertDown, alertEnabled: previous?.alertEnabled ?? true };
  const holdings = state.editingHoldingSecid
    ? state.settings.holdings.map((holding) => holding.secid === state.editingHoldingSecid ? next : holding)
    : [...state.settings.holdings, next];
  const watchlist = state.settings.watchlist.includes(secid) || state.settings.watchlist.length >= 6
    ? state.settings.watchlist
    : [...state.settings.watchlist, secid];

  const editing = Boolean(state.editingHoldingSecid);
  state.holdingFormOpen = false;
  state.editingHoldingSecid = null;
  await saveSettings({ holdings, watchlist, selectedSecid: secid });
  await refreshMarket();
  showToast(editing ? '持仓与提醒已更新' : '已加入持仓并开启提醒');
}

function bindChartHover() {
  const svg = document.querySelector<SVGSVGElement>('.kline-svg');
  const tooltip = document.querySelector<HTMLDivElement>('#kline-tooltip');
  const snapshot = state.kline?.secid === state.settings.selectedSecid && state.kline.period === state.chartPeriod ? state.kline : null;
  if (!svg || !tooltip || !snapshot) return;
  const crosshair = svg.querySelector<SVGLineElement>('#chart-crosshair');
  const start = Number(svg.dataset.start || 0);
  const left = Number(svg.dataset.left || 0);
  const right = Number(svg.dataset.right || 1);
  const count = Number(svg.dataset.count || 1);
  svg.addEventListener('mousemove', (event) => {
    const bounds = svg.getBoundingClientRect();
    const viewX = (event.clientX - bounds.left) / bounds.width * 640;
    if (viewX < left || viewX > right) return;
    const index = Math.max(0, Math.min(count - 1, Math.floor((viewX - left) / (right - left) * count)));
    const candle = snapshot.candles[start + index];
    if (!candle) return;
    const candleX = left + (index + .5) / count * (right - left);
    crosshair?.setAttribute('x1', String(candleX));
    crosshair?.setAttribute('x2', String(candleX));
    crosshair?.setAttribute('visibility', 'visible');
    tooltip.innerHTML = `<strong>${escapeHtml(formatCandleTime(candle.time, snapshot.period))}</strong><span>开 ${formatPrice(candle.open)}　高 ${formatPrice(candle.high)}</span><span>低 ${formatPrice(candle.low)}　收 ${formatPrice(candle.close)}</span><small>成交量 ${Math.round(candle.volume).toLocaleString('zh-CN')}</small>`;
    const localX = event.clientX - bounds.left;
    tooltip.style.left = `${Math.max(7, Math.min(bounds.width - 145, localX + (localX > bounds.width * .7 ? -151 : 10)))}px`;
    tooltip.classList.add('visible');
  });
  svg.addEventListener('mouseleave', () => {
    crosshair?.setAttribute('visibility', 'hidden');
    tooltip.classList.remove('visible');
  });
}

async function saveManualWeatherCity(inputId: string) {
  const city = document.querySelector<HTMLInputElement>(`#${inputId}`)?.value.trim();
  if (!city) return showToast('请输入城市');
  state.locationStatus = 'manual';
  await saveSettings({ city, weatherAuto: false });
  await refreshWeather();
  showToast(`已切换到 ${city}`);
}

function clearAiConnectionDraft() {
  state.aiConnectionStatus = 'idle';
  state.aiConnectionTest = null;
  state.aiConnectionError = null;
  state.aiPendingApiKey = '';
  state.aiPendingEndpoint = '';
  state.aiPendingModel = '';
}

function markAiConnectionDirty(message = '配置已修改，请重新测试连接') {
  state.aiConnectionStatus = 'idle';
  state.aiConnectionTest = null;
  state.aiConnectionError = null;
  const panel = document.querySelector<HTMLElement>('.ai-connection-check');
  panel?.classList.remove('success', 'error', 'testing');
  panel?.classList.add('idle');
  const copy = panel?.querySelector<HTMLElement>('b');
  if (copy) copy.textContent = message;
  const button = panel?.querySelector<HTMLButtonElement>('button');
  if (button) {
    button.disabled = false;
    button.textContent = '测试并获取模型';
  }
}

async function testAiConnection() {
  const endpoint = document.querySelector<HTMLInputElement>('#ai-endpoint')?.value.trim() || state.aiPendingEndpoint || state.settings.aiEndpoint;
  const apiKeyInput = document.querySelector<HTMLInputElement>('#ai-api-key')?.value.trim() || '';
  const apiKey = apiKeyInput || state.aiPendingApiKey || undefined;
  const model = document.querySelector<HTMLInputElement | HTMLSelectElement>('#ai-model')?.value.trim() || state.aiPendingModel || state.settings.aiModel;
  state.aiPendingEndpoint = endpoint;
  state.aiPendingModel = model;
  if (apiKeyInput) state.aiPendingApiKey = apiKeyInput;
  state.aiConnectionStatus = 'testing';
  state.aiConnectionError = null;
  render();
  try {
    const result = await window.floatdeck.testAiConnection({ endpoint, apiKey });
    state.aiConnectionTest = result;
    const matched = result.models.find((item) => item.id === model);
    state.aiPendingModel = matched?.id || result.models.find((item) => item.chatCompatible)?.id || result.models[0].id;
    state.aiConnectionStatus = 'success';
  } catch (error) {
    state.aiConnectionTest = null;
    state.aiConnectionStatus = 'error';
    state.aiConnectionError = error instanceof Error ? error.message : '连接测试失败';
  }
  render();
}

async function saveAiConfiguration(clearKey = false) {
  const endpoint = document.querySelector<HTMLInputElement>('#ai-endpoint')?.value.trim() || state.aiPendingEndpoint || state.settings.aiEndpoint;
  const model = document.querySelector<HTMLInputElement | HTMLSelectElement>('#ai-model')?.value.trim() || state.aiPendingModel || state.settings.aiModel;
  const apiKey = document.querySelector<HTMLInputElement>('#ai-api-key')?.value.trim() || state.aiPendingApiKey || undefined;
  const prompt = document.querySelector<HTMLTextAreaElement>('#ai-prompt')?.value.trim() || state.settings.aiPrompt;
  const roleId = document.querySelector<HTMLSelectElement>('#ai-settings-role')?.value || state.settings.aiRoleId;
  const taskId = document.querySelector<HTMLSelectElement>('#ai-settings-task')?.value || state.settings.aiTaskId;
  const connectionChanged = endpoint !== state.settings.aiEndpoint || Boolean(apiKey);
  if (!clearKey && connectionChanged && state.aiConnectionStatus !== 'success') {
    state.aiPendingEndpoint = endpoint;
    state.aiPendingModel = model;
    if (apiKey) state.aiPendingApiKey = apiKey;
    return showToast('请先测试连接并获取可用模型');
  }
  try {
    state.settings = await window.floatdeck.saveAiConfig({ endpoint, model, prompt, roleId, taskId, apiKey, clearKey });
    const catalogModel = state.aiCatalog.models[0];
    if (catalogModel) state.aiCatalog.models[0] = { ...catalogModel, endpoint: state.settings.aiEndpoint, model: state.settings.aiModel, provider: new URL(state.settings.aiEndpoint).hostname, configured: state.settings.aiHasKey || ['localhost', '127.0.0.1', '::1'].includes(new URL(state.settings.aiEndpoint).hostname) };
    state.aiPendingApiKey = '';
    state.aiPendingEndpoint = '';
    state.aiPendingModel = '';
    if (clearKey) clearAiConnectionDraft();
    showToast(clearKey ? 'API Key 已清除' : 'AI 配置已加密保存');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'AI 配置保存失败');
  }
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    element.addEventListener('click', async (event) => {
      const target = event.currentTarget as HTMLElement;
      const action = target.dataset.action;
      if (action === 'refresh') refreshAll(true);
      if (action === 'hide') window.floatdeck.hide();
      if (action === 'cycle-theme') cycleTheme();
      if (action === 'toggle-pin') {
        const alwaysOnTop = !state.settings.alwaysOnTop;
        await saveSettings({ alwaysOnTop });
        showToast(alwaysOnTop ? '已置顶' : '已取消置顶');
      }
      if (action === 'open-stocks') setPanel(state.panel === 'stocks' ? 'closed' : 'stocks');
      if (action === 'open-chart') {
        if (state.panel === 'chart') await setPanel('closed');
        else {
          state.chartMode = 'kline';
          await setPanel('chart');
          await refreshKline();
        }
      }
      if (action === 'show-kline') {
        state.chartMode = 'kline';
        render();
        if (!state.kline || state.kline.secid !== state.settings.selectedSecid || state.kline.period !== state.chartPeriod) await refreshKline();
      }
      if (action === 'show-funds') {
        state.chartMode = 'funds';
        state.aiError = null;
        render();
        await refreshFundFlow();
      }
      if (action === 'show-ai') {
        state.chartMode = 'ai';
        state.aiError = null;
        render();
      }
      if (action === 'run-ai-agent') await runAiAnalysis();
      if (action === 'test-ai-connection') await testAiConnection();
      if (action === 'open-weather') {
        if (state.panel === 'weather') await setPanel('closed');
        else {
          await setPanel('weather');
          if (!state.weather) await refreshWeather();
        }
      }
      if (action === 'open-holdings') {
        if (state.panel === 'holdings') {
          state.holdingFormOpen = false;
          state.editingHoldingSecid = null;
          setPanel('closed');
        } else {
          setPanel('holdings');
        }
      }
      if (action === 'open-settings') {
        const requestedSection = target.dataset.settingsTarget as SettingsSection | undefined;
        if (requestedSection) state.settingsSection = requestedSection;
        setPanel('settings');
      }
      if (action === 'toggle-ai-history') {
        state.aiHistoryOpen = !state.aiHistoryOpen;
        render();
      }
      if (action === 'open-ai-history') {
        const analysis = state.aiHistory.find((item) => item.id === target.dataset.historyId);
        if (analysis) {
          state.aiAnalysis = analysis;
          state.aiError = null;
          const patch: Partial<FloatDeckSettings> = { aiRoleId: analysis.roleId, aiTaskId: analysis.taskId };
          if (analysis.scope === 'stock' && /^[012]\.\d{6}$/.test(analysis.secid)) patch.selectedSecid = analysis.secid;
          await saveSettings(patch, false);
          render();
        }
      }
      if (action === 'remove-ai-history') {
        const id = target.dataset.historyId || '';
        state.aiHistory = await window.floatdeck.removeAiHistory(id);
        if (state.aiAnalysis?.id === id) state.aiAnalysis = null;
        render();
      }
      if (action === 'clear-ai-history') {
        state.aiHistory = await window.floatdeck.clearAiHistory();
        state.aiAnalysis = null;
        render();
      }
      if (action === 'copy-ai-report' && state.aiAnalysis) {
        await window.floatdeck.copyText(analysisToMarkdown(state.aiAnalysis));
        showToast('研判报告已复制为 Markdown');
      }
      if (action === 'close-panel') {
        if (state.panel === 'settings') clearAiConnectionDraft();
        state.holdingFormOpen = false;
        state.editingHoldingSecid = null;
        setPanel('closed');
      }
      if (action === 'select-stock') {
        await saveSettings({ selectedSecid: target.dataset.secid || INDEX_SECIDS[0] });
        await setPanel('closed');
      }
      if (action === 'remove-stock') {
        const secid = target.dataset.secid!;
        const watchlist = state.settings.watchlist.filter((item) => item !== secid);
        const selectedSecid = state.settings.selectedSecid === secid ? INDEX_SECIDS[0] : state.settings.selectedSecid;
        await saveSettings({ watchlist, selectedSecid });
      }
      if (action === 'new-holding') {
        state.holdingFormOpen = true;
        state.editingHoldingSecid = null;
        render();
      }
      if (action === 'cancel-holding-form') {
        state.holdingFormOpen = false;
        state.editingHoldingSecid = null;
        render();
      }
      if (action === 'edit-holding') {
        state.holdingFormOpen = true;
        state.editingHoldingSecid = target.dataset.secid || null;
        render();
      }
      if (action === 'select-holding') {
        await saveSettings({ selectedSecid: target.dataset.secid || INDEX_SECIDS[0] });
        await setPanel('closed');
      }
      if (action === 'toggle-holding-alert') {
        const secid = target.dataset.secid;
        const holdings = state.settings.holdings.map((holding) => holding.secid === secid ? { ...holding, alertEnabled: !holding.alertEnabled } : holding);
        const enabled = holdings.find((holding) => holding.secid === secid)?.alertEnabled;
        await saveSettings({ holdings });
        showToast(enabled ? '已开启涨跌幅提醒' : '已暂停这只股票的提醒');
      }
      if (action === 'remove-holding') {
        const secid = target.dataset.secid;
        const holdings = state.settings.holdings.filter((holding) => holding.secid !== secid);
        if (state.editingHoldingSecid === secid) {
          state.holdingFormOpen = false;
          state.editingHoldingSecid = null;
        }
        await saveSettings({ holdings });
        showToast('已删除持仓');
      }
      if (action === 'add-stock') {
        const code = document.querySelector<HTMLInputElement>('#stock-input')?.value.trim() || '';
        const secid = secidFromCode(code);
        if (!secid) return showToast('请输入正确的 6 位代码');
        if (state.settings.watchlist.includes(secid)) return showToast('已经在自选里了');
        if (state.settings.watchlist.length >= 6) return showToast('最多添加 6 只');
        await saveSettings({ watchlist: [...state.settings.watchlist, secid], selectedSecid: secid });
        await refreshMarket();
        showToast('已添加并设为当前');
      }
      if (action === 'save-city') {
        await saveManualWeatherCity('city-input');
      }
      if (action === 'save-weather-city') {
        await saveManualWeatherCity('weather-city-input');
      }
      if (action === 'locate-weather') {
        await saveSettings({ weatherAuto: true });
        await refreshWeather(true);
        if (state.locationStatus === 'located') showToast('已跟随当前位置');
      }
      if (action === 'save-ai-config') await saveAiConfiguration(false);
      if (action === 'clear-ai-key') await saveAiConfiguration(true);
    });
  });

  document.querySelector<HTMLFormElement>('[data-holding-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveHoldingFromForm();
  });

  document.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach((element) => {
    element.addEventListener('click', () => saveSettings({ theme: element.dataset.themeChoice as ThemeName }));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-settings-section]').forEach((element) => {
    element.addEventListener('click', () => {
      state.settingsSection = element.dataset.settingsSection as SettingsSection;
      render();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-chart-period]').forEach((element) => {
    element.addEventListener('click', async () => {
      state.chartPeriod = element.dataset.chartPeriod as ChartPeriod;
      await refreshKline();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-indicator]').forEach((element) => {
    element.addEventListener('click', () => {
      const indicator = element.dataset.indicator!;
      if (element.dataset.indicatorKind === 'overlay') {
        const next = new Set(state.chartOverlays);
        if (next.has(indicator as OverlayIndicator)) next.delete(indicator as OverlayIndicator);
        else next.add(indicator as OverlayIndicator);
        state.chartOverlays = next;
      } else {
        state.chartSubIndicator = indicator as SubIndicator;
      }
      render();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-fund-range]').forEach((element) => {
    element.addEventListener('click', () => {
      state.fundRange = Number(element.dataset.fundRange) as FundRange;
      render();
    });
  });

  document.querySelectorAll<HTMLSelectElement>('[data-ai-select]').forEach((element) => {
    element.addEventListener('change', async () => {
      const kind = element.dataset.aiSelect;
      const context = element.dataset.aiContext;
      if (context === 'settings') {
        if (kind === 'role') {
          const tasks = aiTasksForRole(element.value);
          const taskSelect = document.querySelector<HTMLSelectElement>('#ai-settings-task');
          if (taskSelect) taskSelect.innerHTML = aiTaskOptions(element.value, tasks[0]?.id);
          if (tasks[0]) updateAiSettingsContractPreview(element.value, tasks[0].id);
        } else {
          const roleId = document.querySelector<HTMLSelectElement>('#ai-settings-role')?.value || state.settings.aiRoleId;
          updateAiSettingsContractPreview(roleId, element.value);
        }
        return;
      }
      const roleId = kind === 'role' ? element.value : state.settings.aiRoleId;
      const roleTasks = aiTasksForRole(roleId);
      const taskId = kind === 'role' ? roleTasks[0]?.id : element.value;
      if (!taskId) return;
      state.aiError = null;
      await saveSettings({ aiRoleId: roleId, aiTaskId: taskId });
    });
  });

  document.querySelector<HTMLInputElement>('#ai-endpoint')?.addEventListener('input', (event) => {
    state.aiPendingEndpoint = (event.currentTarget as HTMLInputElement).value.trim();
    markAiConnectionDirty();
  });

  document.querySelector<HTMLInputElement>('#ai-api-key')?.addEventListener('input', (event) => {
    state.aiPendingApiKey = (event.currentTarget as HTMLInputElement).value.trim();
    markAiConnectionDirty('新的 API Key 需要先验证');
  });

  const modelControl = document.querySelector<HTMLInputElement | HTMLSelectElement>('#ai-model');
  modelControl?.addEventListener(modelControl instanceof HTMLSelectElement ? 'change' : 'input', () => {
    state.aiPendingModel = modelControl.value.trim();
  });

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((input) => {
    const eventName = input instanceof HTMLInputElement && input.type === 'range' ? 'input' : 'change';
    input.addEventListener(eventName, async () => {
      const key = input.dataset.setting as keyof FloatDeckSettings;
      const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked
        : input instanceof HTMLInputElement && input.type === 'range' ? Number(input.value) / 100
          : Number(input.value);
      if (key === 'opacity') {
        const output = document.querySelector('#opacity-value');
        if (output) output.textContent = `${input.value}%`;
      }
      await saveSettings({ [key]: value }, false);
    });
  });
}

async function refreshCodex() {
  state.codex = await window.floatdeck.refreshCodex();
  renderDataUpdate();
}

async function refreshMarket() {
  const secids = allSecids();
  try {
    const result = await window.floatdeck.refreshMarket(secids);
    result.items.forEach((item) => state.market.set(item.secid, item));
    state.marketLive = true;
  } catch {
    state.marketLive = false;
    const samples: Record<string, [string, string, number, number]> = {
      '1.000001': ['000001', '上证指数', 3887.92, -0.66],
      '0.399001': ['399001', '深证成指', 14461.20, -0.42],
      '0.399006': ['399006', '创业板指', 3712.74, -0.29],
      '0.300750': ['300750', '宁德时代', 355.00, -1.13],
      '1.600519': ['600519', '贵州茅台', 1219.19, 0.68],
    };
    secids.forEach((secid) => {
      if (state.market.has(secid) || !samples[secid]) return;
      const [code, name, price, percent] = samples[secid];
      state.market.set(secid, { secid, code, name, price, percent, change: 0, trend: SAMPLE_TRENDS[secid] || [] });
    });
  }
  renderDataUpdate();
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('当前系统不支持定位'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60_000 });
  });
}

async function refreshKline() {
  state.loading.add('kline');
  render();
  try {
    state.kline = await window.floatdeck.refreshKline(state.settings.selectedSecid, state.chartPeriod);
  } catch {
    showToast('K 线数据加载失败');
  } finally {
    state.loading.delete('kline');
    render();
  }
}

async function refreshFundFlow() {
  state.loading.add('fund-flow');
  render();
  try {
    state.fundFlow = await window.floatdeck.refreshFundFlow(state.settings.selectedSecid);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '资金流数据加载失败');
  } finally {
    state.loading.delete('fund-flow');
    render();
  }
}

async function runAiAnalysis() {
  const role = selectedAiRole();
  const task = selectedAiTask();
  state.aiError = null;
  state.loading.add('ai-analysis');
  render();
  try {
    state.aiAnalysis = await window.floatdeck.analyzeStock({ modelId: 'primary', roleId: role.id, taskId: task.id, secid: state.settings.selectedSecid });
    state.aiHistory = [state.aiAnalysis, ...state.aiHistory.filter((item) => item.id !== state.aiAnalysis?.id)].slice(0, 30);
  } catch (error) {
    state.aiError = error instanceof Error ? error.message : 'AI 研判失败';
  } finally {
    state.loading.delete('ai-analysis');
    render();
  }
}

async function refreshWeather(forceLocation = false) {
  let query: string | WeatherQuery = state.settings.city;
  if (state.settings.weatherAuto || forceLocation) {
    state.locationStatus = 'locating';
    state.locationError = null;
    if (state.panel === 'weather') render();
    try {
      const position = await currentPosition();
      query = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      state.locationStatus = 'located';
    } catch (error) {
      state.locationStatus = 'failed';
      state.locationError = error instanceof Error ? error.message : '系统定位不可用';
      query = state.settings.city;
    }
  } else {
    state.locationStatus = 'manual';
  }
  try {
    state.weather = await window.floatdeck.refreshWeather(query);
  } catch {
    showToast('天气刷新失败');
  }
  renderDataUpdate();
}

function renderDataUpdate() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
  render();
}

async function refreshAll(manual = false) {
  if (manual) {
    state.loading.add('manual');
    render();
  }
  try {
    const tasks = [refreshCodex(), refreshMarket(), refreshWeather()];
    if (state.panel === 'chart' && state.chartMode === 'kline') tasks.push(refreshKline());
    if (state.panel === 'chart' && state.chartMode === 'funds') tasks.push(refreshFundFlow());
    await Promise.allSettled(tasks);
  } finally {
    if (manual) {
      state.loading.delete('manual');
      showToast('已刷新');
    }
  }
}

async function bootstrap() {
  const initial = await window.floatdeck.getBootstrap();
  state.settings = { ...state.settings, ...initial.settings };
  state.aiCatalog = initial.aiCatalog;
  state.aiHistory = initial.aiHistory;
  state.alertStatus = initial.alertStatus;
  render();
  if (state.panel !== 'closed') await window.floatdeck.resizePanel(state.panel);
  await refreshAll();
  window.setInterval(refreshCodex, 60_000);
  window.setInterval(refreshMarket, 45_000);
  window.setInterval(refreshWeather, 15 * 60_000);
  window.setInterval(() => {
    if (state.panel !== 'chart') return;
    if (state.chartMode === 'kline') refreshKline();
    if (state.chartMode === 'funds') refreshFundFlow();
  }, 5 * 60_000);
  window.floatdeck.onRefreshRequested(() => refreshAll(true));
  window.floatdeck.onHoldingAlert((alert) => showToast(alert.message));
  window.floatdeck.onAlertStatus((status) => {
    state.alertStatus = status;
    if (state.panel === 'settings' && state.settingsSection === 'alerts') renderDataUpdate();
  });
}

render();
bootstrap();

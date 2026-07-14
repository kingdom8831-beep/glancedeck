import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, session, Tray } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
if (process.env.FLOATDECK_CAPTURE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.FLOATDECK_CAPTURE_USER_DATA));
}
const LEGACY_AI_PROMPT = '你是一名严谨的 A 股研究助手。仅依据提供的实时行情、K 线、资金流和持仓数据研判，不虚构新闻或基本面信息。请用中文依次输出：趋势判断、资金行为、关键价位、持仓视角、风险点、简短结论。明确区分事实与推断，结论保持克制。';
const DEFAULT_AI_PROMPT = '结论保持简洁，优先指出最关键的机会、风险与需要继续观察的数据。';
const MARKET_INDEX_SECIDS = ['1.000001', '0.399001', '0.399006'];
const AI_COMMON_PROMPT = `你是瞬览内置的 A 股研判执行器。只能依据用户消息中提供的 JSON 证据工作，不得虚构新闻、政策、行业、财务、估值或市场宽度数据。明确区分数据事实与推断；数据不足时直接说明。金额与价格保留合适精度，使用中文输出。不要给出保证收益、满仓、梭哈等绝对化指令。严格执行所选系统角色与任务模板，不要擅自改变适用范围和输出结构。`;
const AI_TOOLS = [
  { id: 'realtime-quote', code: 'QUOTE', name: '多源实时行情', description: '价格、涨跌幅、时间戳与数据源校验' },
  { id: 'daily-kline', code: 'KLINE', name: '日 K 线', description: '近期 OHLCV、趋势结构与关键价位' },
  { id: 'fund-flow', code: 'FLOW', name: '资金趋势', description: '盘中与日级主力、大小单净流入' },
  { id: 'market-indices', code: 'INDEX', name: '三大指数', description: '上证、深证、创业板的市场上下文' },
  { id: 'watchlist', code: 'WATCH', name: '自选样本', description: '用户自选与持仓标的的观察样本' },
  { id: 'holding-context', code: 'HOLD', name: '单股持仓', description: '成本、数量、盈亏与提醒阈值' },
  { id: 'portfolio-positions', code: 'PORT', name: '组合持仓', description: '持仓市值、权重、收益与当日贡献' },
  { id: 'portfolio-signals', code: 'SIGNAL', name: '持仓信号', description: '高权重持仓的 K 线与资金细节' },
];
const AI_SYSTEM_ROLES = [
  {
    id: 'a-share-research',
    code: 'RESEARCH',
    name: 'A股投研系统角色',
    description: '平衡趋势、资金与持仓证据，输出克制的条件式结论',
    prompt: '你是一名严谨、克制的 A 股投研负责人。先核验事实，再形成推断；同时呈现支持与反对当前判断的证据，给出低 / 中 / 高置信度。',
  },
  {
    id: 'capital-observer',
    code: 'CAPITAL',
    name: '资金行为观察员',
    description: '聚焦主力净流入、价格响应与资金持续性',
    prompt: '你是一名 A 股资金行为观察员。优先分析主力、超大单与价格的同步或背离，不把单日流入直接等同于趋势反转，明确持续性证据是否充分。',
  },
  {
    id: 'risk-controller',
    code: 'RISK',
    name: '持仓风险控制官',
    description: '聚焦回撤、集中度、成本线与处置优先级',
    prompt: '你是一名组合风险控制官。优先识别回撤放大、仓位集中、成本失守和资金恶化风险；所有建议必须写成可验证的观察条件，不替用户假设仓外资产。',
  },
];
const AI_TASKS = [
  {
    id: 'market-review', roleId: 'a-share-research', code: 'MARKET', name: 'A股盘前盘后复盘', scope: 'market',
    description: '研判三大指数共振、量价资金与下一交易日条件',
    applicability: '适用于三大指数的当日及近期结构；自选样本不代表全市场宽度。',
    toolIds: ['market-indices', 'realtime-quote', 'daily-kline', 'fund-flow', 'watchlist'],
    outputSections: ['今日定性与置信度', '三大指数共振', '量价与资金', '关键观察位', '下一交易日条件', '一句话结论'],
    prompt: '聚焦上证指数、深证成指、创业板指的当日表现与近期结构。判断指数是否共振、量价是否匹配、资金是否改善；不得把用户观察样本描述成全市场涨跌家数。',
  },
  {
    id: 'stock-multifactor', roleId: 'a-share-research', code: 'EQUITY', name: '个股多因子分析', scope: 'stock',
    description: '综合实时行情、K 线、资金趋势与持仓成本',
    applicability: '适用于当前选中的一只 A 股；不包含未提供的新闻、财务与估值信息。',
    toolIds: ['realtime-quote', 'daily-kline', 'fund-flow', 'holding-context'],
    outputSections: ['核心结论与置信度', '趋势结构', '资金行为', '关键价位', '持仓视角', '风险与条件', '一句话结论'],
    prompt: '围绕当前股票进行多因子研判。检查趋势与资金是否互相验证，关键价位必须能从 K 线证据推导；若没有持仓信息则明确写出。',
  },
  {
    id: 'watchlist-scan', roleId: 'a-share-research', code: 'SCAN', name: '自选结构化扫描', scope: 'market',
    description: '只在用户自选与持仓样本内比较强弱，不扩展到全市场',
    applicability: '适用于已录入的自选与持仓观察样本；不是全 A 股选股器。',
    toolIds: ['market-indices', 'realtime-quote', 'watchlist'],
    outputSections: ['样本概览', '相对强势组', '相对承压组', '指数环境', '观察优先级', '数据边界'],
    prompt: '仅在用户观察样本中做横向比较。按涨跌表现、数据完整度与指数环境给出观察优先级，不得称为全市场排名或推荐股票。',
  },
  {
    id: 'portfolio-review', roleId: 'a-share-research', code: 'PORTFOLIO', name: '自选持仓复盘', scope: 'portfolio',
    description: '从组合角度复盘盈亏贡献、权重和高权重信号',
    applicability: '适用于已录入持仓；不知道总资产、现金与其他账户。',
    toolIds: ['market-indices', 'realtime-quote', 'portfolio-positions', 'portfolio-signals', 'daily-kline', 'fund-flow'],
    outputSections: ['组合体检', '收益与拖累', '集中度', '高权重信号', '处置优先级', '下一步检查', '一句话结论'],
    prompt: '从组合而不是单只股票出发，分析总盈亏、当日贡献、持仓集中度以及高权重仓位的趋势与资金信号。不得假设用户总资产或仓外现金。',
  },
  {
    id: 'capital-trend', roleId: 'capital-observer', code: 'FLOW', name: '个股资金趋势研判', scope: 'stock',
    description: '辨别主力净流入、股价响应、持续性与背离',
    applicability: '适用于当前个股的可用资金流与价格序列；单日数据只作线索。',
    toolIds: ['realtime-quote', 'daily-kline', 'fund-flow'],
    outputSections: ['资金结论与置信度', '当日资金结构', '区间持续性', '价资同步或背离', '关键验证条件', '失效风险'],
    prompt: '以资金趋势为主线，区分当日、近期和区间累计信号。重点判断资金与股价同步、钝化或背离，并写出当前结论需要哪些后续数据验证。',
  },
  {
    id: 'stock-risk', roleId: 'risk-controller', code: 'RISK-1', name: '个股持仓风险检查', scope: 'stock',
    description: '结合成本线、趋势、资金与提醒阈值检查单股风险',
    applicability: '优先适用于已持有的当前个股；无持仓时仅检查市场风险信号。',
    toolIds: ['realtime-quote', 'daily-kline', 'fund-flow', 'holding-context'],
    outputSections: ['风险等级', '成本与回撤', '趋势失效位', '资金风险', '提醒阈值检查', '处置观察条件'],
    prompt: '先检查持仓成本、当前盈亏和提醒阈值，再检查趋势及资金是否恶化。不得给出无条件买卖指令；按“触发条件—风险变化—观察动作”输出。',
  },
  {
    id: 'portfolio-risk', roleId: 'risk-controller', code: 'RISK-N', name: '组合风险与仓位纪律', scope: 'portfolio',
    description: '检查集中度、回撤贡献和需要优先处理的持仓',
    applicability: '适用于已录入组合；权重仅按已录入持仓市值计算。',
    toolIds: ['market-indices', 'realtime-quote', 'portfolio-positions', 'portfolio-signals', 'daily-kline', 'fund-flow'],
    outputSections: ['组合风险等级', '集中度风险', '主要回撤来源', '风险信号排序', '仓位纪律条件', '复查清单'],
    prompt: '从组合风险预算角度排序问题。识别高权重且信号恶化的仓位、收益集中和回撤贡献；明确权重只基于已录入持仓，不能推断用户真实总仓位。',
  },
];

const DEFAULT_SETTINGS = {
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
  aiPrompt: DEFAULT_AI_PROMPT,
  aiApiKeyCipher: '',
  aiRoleId: 'a-share-research',
  aiTaskId: 'stock-multifactor',
  selectedSecid: '1.000001',
  watchlist: ['0.300750', '1.600519'],
  holdings: [],
  bounds: null,
};

let settings = { ...DEFAULT_SETTINGS };
let windowRef = null;
let trayRef = null;
let trayMenuRef = null;
let menuBarHelperRef = null;
let menuBarHelperRestartTimer = null;
let lastCodexUsage = null;
let isQuitting = false;
let saveTimer = null;
let holdingAlertTimer = null;
let holdingAlertKickTimer = null;
let holdingAlertInFlight = false;
let holdingAlertStates = {};
let aiAnalysisHistory = [];
let holdingAlertStatus = {
  running: false,
  lastCheckAt: 0,
  lastSuccessAt: 0,
  lastError: null,
  skippedReason: 'starting',
  enabledCount: 0,
  freshCount: 0,
  staleCount: 0,
};
const activeNotifications = new Set();
const PANEL_SIZES = {
  closed: { width: 296, height: 156 },
  stocks: { width: 296, height: 420 },
  holdings: { width: 296, height: 480 },
  settings: { width: 340, height: 600 },
  weather: { width: 330, height: 500 },
  chart: { width: 680, height: 600 },
};
let compactPosition = null;

function debugLog(...values) {
  if (process.env.FLOATDECK_DEBUG) console.log('[GlanceDeck]', ...values);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function holdingAlertStatePath() {
  return path.join(app.getPath('userData'), 'holding-alert-state.json');
}

function aiAnalysisHistoryPath() {
  return path.join(app.getPath('userData'), 'ai-analysis-history.json');
}

function menuBarStatePath() {
  return path.join(app.getPath('userData'), 'menubar-state.json');
}

function sanitizeHoldings(holdings) {
  const unique = new Map();
  for (const raw of Array.isArray(holdings) ? holdings : []) {
    const secid = String(raw?.secid || '');
    const shares = Math.round(Number(raw?.shares));
    const costPrice = Number(raw?.costPrice);
    const alertUp = Number(raw?.alertUp);
    const alertDown = Number(raw?.alertDown);
    if (!/^[012]\.\d{6}$/.test(secid) || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(costPrice) || costPrice <= 0) continue;
    unique.set(secid, {
      secid,
      shares: Math.min(shares, 1_000_000_000),
      costPrice: Math.min(costPrice, 1_000_000),
      alertUp: Math.max(0.1, Math.min(100, Number.isFinite(alertUp) ? alertUp : 3)),
      alertDown: Math.max(0.1, Math.min(100, Number.isFinite(alertDown) ? alertDown : 3)),
      alertEnabled: raw?.alertEnabled !== false,
    });
  }
  return [...unique.values()].slice(0, 12);
}

function holdingAlertSignature(holding) {
  return `${holding.alertEnabled}:${holding.alertUp}:${holding.alertDown}`;
}

function normalizeSettings(next) {
  const normalized = { ...DEFAULT_SETTINGS, ...next, uiVersion: 5 };
  if (!['glass', 'cozy', 'cyber'].includes(normalized.theme)) normalized.theme = 'glass';
  normalized.city = String(normalized.city || '上海').trim().slice(0, 40) || '上海';
  normalized.alwaysOnTop = Boolean(normalized.alwaysOnTop);
  normalized.allWorkspaces = Boolean(normalized.allWorkspaces);
  normalized.weatherAuto = normalized.weatherAuto !== false;
  normalized.launchAtLogin = Boolean(normalized.launchAtLogin);
  normalized.alertTradingHoursOnly = normalized.alertTradingHoursOnly !== false;
  normalized.alertMaxQuoteAgeSeconds = [120, 180, 300, 600].includes(Number(normalized.alertMaxQuoteAgeSeconds)) ? Number(normalized.alertMaxQuoteAgeSeconds) : 180;
  normalized.alertPollIntervalSeconds = [30, 60, 120].includes(Number(normalized.alertPollIntervalSeconds)) ? Number(normalized.alertPollIntervalSeconds) : 60;
  normalized.opacity = Math.max(0.72, Math.min(1, Number(normalized.opacity) || 0.94));
  normalized.aiEndpoint = String(normalized.aiEndpoint || DEFAULT_SETTINGS.aiEndpoint).trim().slice(0, 500);
  try {
    const parsedEndpoint = new URL(normalized.aiEndpoint);
    if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) normalized.aiEndpoint = DEFAULT_SETTINGS.aiEndpoint;
  } catch {
    normalized.aiEndpoint = DEFAULT_SETTINGS.aiEndpoint;
  }
  normalized.aiModel = String(normalized.aiModel || DEFAULT_SETTINGS.aiModel).trim().slice(0, 120);
  normalized.aiPrompt = String(normalized.aiPrompt || DEFAULT_AI_PROMPT).trim().slice(0, 6000) || DEFAULT_AI_PROMPT;
  normalized.aiApiKeyCipher = String(normalized.aiApiKeyCipher || '').slice(0, 20_000);
  const role = AI_SYSTEM_ROLES.find((item) => item.id === normalized.aiRoleId) || AI_SYSTEM_ROLES[0];
  const roleTasks = AI_TASKS.filter((item) => item.roleId === role.id);
  const task = roleTasks.find((item) => item.id === normalized.aiTaskId) || roleTasks[0];
  normalized.aiRoleId = role.id;
  normalized.aiTaskId = task.id;
  normalized.watchlist = sanitizeSecids(normalized.watchlist).slice(0, 6);
  normalized.holdings = sanitizeHoldings(normalized.holdings);
  if (!/^[012]\.\d{6}$/.test(String(normalized.selectedSecid))) normalized.selectedSecid = DEFAULT_SETTINGS.selectedSecid;
  return normalized;
}

function loadSettings() {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    const migrated = Number(parsed.uiVersion) >= 2
      ? { ...parsed, aiPrompt: parsed.aiPrompt === LEGACY_AI_PROMPT ? DEFAULT_AI_PROMPT : parsed.aiPrompt }
      : {
          city: parsed.city,
          alwaysOnTop: parsed.alwaysOnTop,
          allWorkspaces: parsed.allWorkspaces,
          opacity: parsed.opacity,
          watchlist: parsed.watchlist,
          bounds: parsed.bounds ? { x: parsed.bounds.x, y: parsed.bounds.y } : null,
        };
    settings = normalizeSettings(migrated);
  } catch {
    settings = normalizeSettings(DEFAULT_SETTINGS);
  }
}

function loadHoldingAlertStates() {
  try {
    const parsed = JSON.parse(readFileSync(holdingAlertStatePath(), 'utf8'));
    holdingAlertStates = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    holdingAlertStates = {};
  }
}

function sanitizeAiAnalysisHistory(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap((raw) => {
    const content = String(raw?.content || '').trim().slice(0, 120_000);
    const taskId = String(raw?.taskId || '').slice(0, 80);
    const roleId = String(raw?.roleId || '').slice(0, 80);
    if (!content || !taskId || !roleId) return [];
    const updatedAt = Number(raw?.updatedAt) || Date.now();
    return [{
      id: String(raw?.id || `${updatedAt}-${taskId}-${raw?.secid || 'market'}`).slice(0, 180),
      secid: String(raw?.secid || '').slice(0, 40),
      scope: ['market', 'stock', 'portfolio'].includes(raw?.scope) ? raw.scope : 'stock',
      roleId,
      roleName: String(raw?.roleName || roleId).slice(0, 120),
      taskId,
      taskName: String(raw?.taskName || taskId).slice(0, 120),
      title: String(raw?.title || '').slice(0, 120),
      model: String(raw?.model || '').slice(0, 120),
      toolIds: (Array.isArray(raw?.toolIds) ? raw.toolIds : []).map((item) => String(item).slice(0, 80)).slice(0, 20),
      outputSections: (Array.isArray(raw?.outputSections) ? raw.outputSections : []).map((item) => String(item).slice(0, 120)).slice(0, 20),
      content,
      updatedAt,
    }];
  }).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 30);
}

function loadAiAnalysisHistory() {
  try {
    aiAnalysisHistory = sanitizeAiAnalysisHistory(JSON.parse(readFileSync(aiAnalysisHistoryPath(), 'utf8')));
  } catch {
    aiAnalysisHistory = [];
  }
}

function persistAiAnalysisHistory() {
  writeFileSync(aiAnalysisHistoryPath(), JSON.stringify(aiAnalysisHistory, null, 2), 'utf8');
}

function saveAiAnalysisToHistory(analysis) {
  aiAnalysisHistory = sanitizeAiAnalysisHistory([analysis, ...aiAnalysisHistory.filter((item) => item.id !== analysis.id)]);
  persistAiAnalysisHistory();
  return analysis;
}

function removeAiAnalysisFromHistory(id) {
  aiAnalysisHistory = aiAnalysisHistory.filter((item) => item.id !== String(id || ''));
  persistAiAnalysisHistory();
  return aiAnalysisHistory;
}

function clearAiAnalysisHistory() {
  aiAnalysisHistory = [];
  persistAiAnalysisHistory();
  return aiAnalysisHistory;
}

function persistHoldingAlertStates() {
  writeFileSync(holdingAlertStatePath(), JSON.stringify(holdingAlertStates, null, 2), 'utf8');
}

function publicHoldingAlertStatus() {
  return { ...holdingAlertStatus, tradingHoursOnly: settings.alertTradingHoursOnly, pollIntervalSeconds: settings.alertPollIntervalSeconds, maxQuoteAgeSeconds: settings.alertMaxQuoteAgeSeconds };
}

function emitHoldingAlertStatus() {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('holding:alert-status', publicHoldingAlertStatus());
}

function persistSettings() {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function publicSettings() {
  const { aiApiKeyCipher: _secret, ...visible } = settings;
  return { ...visible, aiHasKey: Boolean(settings.aiApiKeyCipher) };
}

function publicAiCatalog() {
  return {
    models: [{
      id: 'primary',
      name: '默认模型服务',
      provider: new URL(settings.aiEndpoint).hostname,
      endpoint: settings.aiEndpoint,
      model: settings.aiModel,
      configured: Boolean(settings.aiApiKeyCipher) || ['localhost', '127.0.0.1', '::1'].includes(new URL(settings.aiEndpoint).hostname),
    }],
    roles: AI_SYSTEM_ROLES.map(({ prompt: _prompt, ...role }) => role),
    tasks: AI_TASKS.map(({ prompt: _prompt, ...task }) => task),
    tools: AI_TOOLS,
  };
}

function encryptAiApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (safeStorage.isEncryptionAvailable()) return `safe:${safeStorage.encryptString(key).toString('base64')}`;
  return `local:${Buffer.from(key, 'utf8').toString('base64')}`;
}

function decryptAiApiKey() {
  const stored = String(settings.aiApiKeyCipher || '');
  try {
    if (stored.startsWith('safe:')) return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'));
    if (stored.startsWith('local:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  } catch (error) {
    debugLog('AI key decrypt failed', error.message);
  }
  return '';
}

function scheduleBoundsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!windowRef || windowRef.isDestroyed()) return;
    settings.bounds = windowRef.getBounds();
    persistSettings();
  }, 250);
}

function safeInitialBounds() {
  const capturePanel = process.env.FLOATDECK_CAPTURE_PANEL;
  const fallback = PANEL_SIZES[capturePanel] || PANEL_SIZES.closed;
  if (!settings.bounds) return fallback;

  const candidate = { ...settings.bounds, ...fallback };
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return candidate.x < area.x + area.width && candidate.x + candidate.width > area.x && candidate.y < area.y + area.height && candidate.y + 80 > area.y;
  });
  return visible ? candidate : fallback;
}

function applyWindowPreferences() {
  if (!windowRef) return;
  windowRef.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  windowRef.setVisibleOnAllWorkspaces(Boolean(settings.allWorkspaces), { visibleOnFullScreen: true });
  windowRef.setOpacity(Math.max(0.72, Math.min(1, Number(settings.opacity) || 0.96)));
}

function applyLaunchAtLogin() {
  if (!app.isPackaged || process.env.FLOATDECK_CAPTURE_PATH) return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin), openAsHidden: true });
  } catch (error) {
    debugLog('Launch at login update failed', error.message);
  }
}

function createWindow() {
  const bounds = safeInitialBounds();
  const solidCapture = Boolean(process.env.FLOATDECK_CAPTURE_SOLID);
  windowRef = new BrowserWindow({
    ...bounds,
    minWidth: 276,
    maxWidth: 700,
    minHeight: 140,
    maxHeight: 640,
    frame: false,
    transparent: !solidCapture,
    resizable: false,
    show: false,
    backgroundColor: solidCapture ? '#eef3f5' : '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === 'darwin') windowRef.setWindowButtonVisibility(false);

  applyWindowPreferences();

  if (process.env.VITE_DEV_SERVER_URL) {
    const panel = process.env.FLOATDECK_CAPTURE_PANEL;
    const mode = process.env.FLOATDECK_CAPTURE_CHART_MODE;
    const section = process.env.FLOATDECK_CAPTURE_SETTINGS_SECTION;
    const query = new URLSearchParams();
    if (panel) query.set('panel', panel);
    if (mode) query.set('mode', mode);
    if (section) query.set('section', section);
    if (process.env.FLOATDECK_CAPTURE_AI_HISTORY) query.set('history', '1');
    windowRef.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query.size ? `?${query}` : ''}`);
  } else {
    const panel = process.env.FLOATDECK_CAPTURE_PANEL;
    const mode = process.env.FLOATDECK_CAPTURE_CHART_MODE;
    const section = process.env.FLOATDECK_CAPTURE_SETTINGS_SECTION;
    windowRef.loadFile(path.join(ROOT, 'dist', 'index.html'), panel || mode || section ? { query: { ...(panel ? { panel } : {}), ...(mode ? { mode } : {}), ...(section ? { section } : {}), ...(process.env.FLOATDECK_CAPTURE_AI_HISTORY ? { history: '1' } : {}) } } : undefined);
  }
  windowRef.webContents.on('console-message', (event) => debugLog('renderer:', event.message));

  windowRef.once('ready-to-show', () => {
    windowRef?.show();
    const capturePath = process.env.FLOATDECK_CAPTURE_PATH;
    if (capturePath) {
      if (process.env.FLOATDECK_CAPTURE_TEST_AI) {
        windowRef?.webContents.executeJavaScript("document.querySelector('[data-action=\\\"test-ai-connection\\\"]')?.click()");
        setTimeout(() => windowRef?.webContents.executeJavaScript("document.querySelector('.model-layer')?.scrollIntoView({block:'start'})"), 700);
      }
      setTimeout(async () => {
        if (!windowRef) return;
        const image = await windowRef.webContents.capturePage();
        writeFileSync(capturePath, image.toPNG());
        isQuitting = true;
        app.quit();
      }, Number(process.env.FLOATDECK_CAPTURE_DELAY || 6500));
    }
  });
  windowRef.on('move', scheduleBoundsSave);
  windowRef.on('resize', scheduleBoundsSave);
  windowRef.on('show', () => updateTrayPresentation());
  windowRef.on('hide', () => updateTrayPresentation());
  windowRef.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    windowRef?.hide();
  });
}

function createTray() {
  const trayPath = app.isPackaged
    ? path.join(process.resourcesPath, 'trayStatus.png')
    : path.join(ROOT, 'build', 'trayStatus.png');
  const image = existsSync(trayPath) ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();
  image.setTemplateImage(false);
  trayRef = new Tray(image);
  debugLog('Tray icon loaded', trayPath, trayRef.getBounds());
  updateTrayPresentation();
  trayRef.on('click', () => trayMenuRef && trayRef?.popUpContextMenu(trayMenuRef));
  trayRef.on('right-click', () => trayMenuRef && trayRef?.popUpContextMenu(trayMenuRef));
}

function persistMenuBarState(usage = lastCodexUsage) {
  const remaining = codexTrayRemaining(usage);
  const resetLabel = trayResetLabel(usage);
  try {
    writeFileSync(menuBarStatePath(), JSON.stringify({ connected: remaining !== null, remaining, resetLabel }));
  } catch (error) {
    debugLog('Menu bar state write failed', error.message);
  }
}

function createMenuBarHelper() {
  if (process.platform !== 'darwin' || process.env.FLOATDECK_CAPTURE_PATH || menuBarHelperRef) return;
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'GlanceDeckMenuBar')
    : path.join(ROOT, 'build', 'GlanceDeckMenuBar');
  if (!existsSync(helperPath)) {
    debugLog('Native menu bar helper missing, falling back to Electron Tray', helperPath);
    createTray();
    return;
  }
  persistMenuBarState();
  menuBarHelperRef = spawn(helperPath, [String(process.pid), menuBarStatePath()], { stdio: 'ignore' });
  menuBarHelperRef.on('error', (error) => {
    debugLog('Menu bar helper failed, falling back to Electron Tray', error.message);
    if (!trayRef) createTray();
  });
  menuBarHelperRef.on('exit', () => {
    menuBarHelperRef = null;
    if (!isQuitting) {
      clearTimeout(menuBarHelperRestartTimer);
      menuBarHelperRestartTimer = setTimeout(createMenuBarHelper, 1500);
    }
  });
  setTimeout(() => app.dock?.hide(), 1100);
}

function codexTrayRemaining(usage = lastCodexUsage) {
  const used = Number(usage?.primary?.usedPercent);
  if (!usage?.connected || !Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

function trayResetLabel(usage = lastCodexUsage) {
  const resetsAt = Number(usage?.primary?.resetsAt);
  if (!Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(resetsAt * 1000));
}

function updateTrayPresentation(usage = lastCodexUsage) {
  if (usage) lastCodexUsage = usage;
  if (process.platform === 'darwin') persistMenuBarState();
  if (!trayRef) return;
  const remaining = codexTrayRemaining();
  const resetLabel = trayResetLabel();
  const connected = remaining !== null;
  const title = connected ? `${remaining}%` : '···';
  if (process.platform === 'darwin') trayRef.setTitle(title, { fontType: 'monospacedDigit' });
  trayRef.setToolTip(connected ? `瞬览 GlanceDeck · Codex 剩余 ${remaining}%` : '瞬览 GlanceDeck · Codex 用量同步中');
  trayMenuRef = Menu.buildFromTemplate([
    { label: connected ? `Codex 剩余 ${remaining}%` : 'Codex 用量同步中' },
    ...(resetLabel ? [{ label: `本周期重置：${resetLabel}` }] : []),
    { type: 'separator' },
    { label: windowRef?.isVisible() ? '隐藏悬浮窗' : '显示悬浮窗', click: () => windowRef?.isVisible() ? windowRef.hide() : showWindow() },
    { label: '立即刷新', click: () => windowRef?.webContents.send('app:refresh') },
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: Boolean(settings.alwaysOnTop),
      click: (item) => updateSettings({ alwaysOnTop: item.checked }),
    },
    { type: 'separator' },
    { label: '退出瞬览', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function showWindow() {
  if (!windowRef) createWindow();
  windowRef?.show();
  windowRef?.focus();
  updateTrayPresentation();
}

function updateSettings(patch) {
  const previousHoldings = settings.holdings;
  const previousAlertConfig = `${settings.alertTradingHoursOnly}:${settings.alertMaxQuoteAgeSeconds}:${settings.alertPollIntervalSeconds}`;
  const { aiApiKeyCipher: _ignoredCipher, aiHasKey: _ignoredKeyState, ...safePatch } = patch || {};
  settings = normalizeSettings({ ...settings, ...safePatch, aiApiKeyCipher: settings.aiApiKeyCipher });
  if (Object.prototype.hasOwnProperty.call(patch, 'holdings')) {
    const previousById = new Map(previousHoldings.map((holding) => [holding.secid, holding]));
    const retainedStates = {};
    for (const holding of settings.holdings) {
      const previous = previousById.get(holding.secid);
      if (previous && holdingAlertSignature(previous) === holdingAlertSignature(holding) && holdingAlertStates[holding.secid]) {
        retainedStates[holding.secid] = holdingAlertStates[holding.secid];
      }
    }
    holdingAlertStates = retainedStates;
    persistHoldingAlertStates();
    clearTimeout(holdingAlertKickTimer);
    holdingAlertKickTimer = setTimeout(checkHoldingAlerts, 1200);
  }
  persistSettings();
  applyWindowPreferences();
  if (Object.prototype.hasOwnProperty.call(safePatch, 'launchAtLogin')) applyLaunchAtLogin();
  const nextAlertConfig = `${settings.alertTradingHoursOnly}:${settings.alertMaxQuoteAgeSeconds}:${settings.alertPollIntervalSeconds}`;
  if (previousAlertConfig !== nextAlertConfig && !process.env.FLOATDECK_CAPTURE_PATH) startHoldingAlertMonitor();
  if (trayRef) createTrayMenuOnly();
  return publicSettings();
}

function createTrayMenuOnly() {
  updateTrayPresentation();
}

function findCodexBinary() {
  const candidates = [
    process.env.CODEX_CLI_PATH,
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(app.getPath('home'), '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next common location.
    }
  }

  const which = spawnSync('which', ['codex'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

class CodexAppServer {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.lastError = null;
  }

  async connect() {
    if (this.ready) return this.ready;
    this.ready = this.start();
    try {
      await this.ready;
    } catch (error) {
      this.ready = null;
      throw error;
    }
  }

  async start() {
    const binary = findCodexBinary();
    if (!binary) throw new Error('未找到 Codex CLI');

    this.proc = spawn(binary, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, RUST_LOG: 'error' },
    });

    const lines = readline.createInterface({ input: this.proc.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id);
          this.pending.delete(message.id);
          clearTimeout(entry.timeout);
          if (message.error) entry.reject(new Error(message.error.message || 'Codex app-server error'));
          else entry.resolve(message.result);
        }
      } catch {
        // Ignore malformed diagnostic output.
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      this.lastError = String(chunk).trim();
    });

    this.proc.on('exit', () => {
      const error = new Error(this.lastError || 'Codex app-server 已退出');
      for (const { reject, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        reject(error);
      }
      this.pending.clear();
      this.proc = null;
      this.ready = null;
    });

    await this.request('initialize', {
      clientInfo: { name: 'floatdeck', title: '瞬览 GlanceDeck', version: '0.1.0' },
      capabilities: null,
    }, true);
    this.send({ method: 'initialized', params: {} });
  }

  send(message) {
    if (!this.proc?.stdin.writable) throw new Error('Codex app-server 未连接');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params, duringInit = false) {
    if (!duringInit) await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ method, id, params });
    });
  }

  async getUsage() {
    const response = await this.request('account/rateLimits/read', undefined);
    const buckets = response?.rateLimitsByLimitId;
    const snapshot = buckets?.codex || Object.values(buckets || {})[0] || response?.rateLimits;
    if (!snapshot) throw new Error('Codex 未返回用量信息');
    return {
      connected: true,
      planType: snapshot.planType || null,
      limitName: snapshot.limitName || 'Codex',
      primary: snapshot.primary || null,
      secondary: snapshot.secondary || null,
      credits: snapshot.credits || null,
      reachedType: snapshot.rateLimitReachedType || null,
      updatedAt: Date.now(),
    };
  }

  close() {
    this.proc?.kill('SIGTERM');
  }
}

const codexServer = new CodexAppServer();

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await net.fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function fetchCurlJson(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['-sS', '--max-time', '10', '-A', 'Mozilla/5.0', '-e', 'https://quote.eastmoney.com/', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `curl exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('历史资金流返回无法解析')); }
    });
  });
}

function sanitizeSecids(secids) {
  return [...new Set((Array.isArray(secids) ? secids : [])
    .map((value) => String(value))
    .filter((value) => /^[012]\.\d{6}$/.test(value)))]
    .slice(0, 24);
}

function tencentSymbol(secid) {
  const [market, code] = secid.split('.');
  return `${market === '1' ? 'sh' : market === '2' ? 'bj' : 'sz'}${code}`;
}

async function fetchTencent(url, encoding = 'utf8') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Referer: 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    return new TextDecoder(encoding).decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSina(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new TextDecoder('gb18030').decode(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEastmoney(pathAndQuery) {
  let lastError;
  for (const host of ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com']) {
    try {
      const joiner = pathAndQuery.includes('?') ? '&' : '?';
      return await fetchJson(`${host}${pathAndQuery}${joiner}_=${Math.floor(Date.now() / 1000)}`, {
        headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('东方财富数据源不可用');
}

function marketTimestamp(date, time = '') {
  const digits = `${date || ''}${time || ''}`.replace(/\D/g, '');
  if (digits.length < 8) return 0;
  const padded = digits.padEnd(14, '0');
  const iso = `${padded.slice(0, 4)}-${padded.slice(4, 6)}-${padded.slice(6, 8)}T${padded.slice(8, 10)}:${padded.slice(10, 12)}:${padded.slice(12, 14)}+08:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getTrend(secid) {
  const symbol = tencentSymbol(secid);
  const text = await fetchTencent(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`);
  const json = JSON.parse(text);
  return (json?.data?.[symbol]?.data?.data || [])
    .map((row) => Number(String(row).split(' ')[1]))
    .filter(Number.isFinite);
}

async function getTencentQuotes(secids, includeTrend) {
  const symbols = secids.map(tencentSymbol);
  const quoteText = await fetchTencent(`https://qt.gtimg.cn/q=${symbols.join(',')}`, 'gb18030');
  const rows = new Map();
  for (const match of quoteText.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
    rows.set(match[1], match[2].split('~'));
  }
  const entries = await Promise.all(secids.map(async (secid) => {
    const symbol = tencentSymbol(secid);
    const row = rows.get(symbol);
    if (!row || !row[1]) return null;
    let trend = [];
    if (includeTrend) {
      try { trend = await getTrend(secid); } catch { /* Quote still remains useful. */ }
    }
    return [secid, {
      secid,
      code: row[2],
      name: row[1],
      price: Number(row[3]),
      percent: Number(row[32]),
      change: Number(row[31]),
      trend,
      timestamp: marketTimestamp(row[30]),
      source: '腾讯',
    }];
  }));
  return new Map(entries.filter(Boolean));
}

async function getSinaQuotes(secids) {
  const symbols = secids.map(tencentSymbol);
  const text = await fetchSina(`https://hq.sinajs.cn/list=${symbols.join(',')}`);
  const bySymbol = new Map(symbols.map((symbol, index) => [symbol, secids[index]]));
  const quotes = new Map();
  for (const match of text.matchAll(/var hq_str_([a-z]{2}\d{6})="([^"]*)"/g)) {
    const secid = bySymbol.get(match[1]);
    const row = match[2].split(',');
    if (!secid || !row[0]) continue;
    const previousClose = Number(row[2]);
    const price = Number(row[3]);
    quotes.set(secid, {
      secid,
      code: secid.split('.')[1],
      name: row[0],
      price,
      percent: previousClose ? (price - previousClose) / previousClose * 100 : 0,
      change: price - previousClose,
      trend: [],
      timestamp: marketTimestamp(row[30], row[31]),
      source: '新浪',
    });
  }
  return quotes;
}

async function getEastmoneyQuotes(secids) {
  const entries = await Promise.all(secids.map(async (secid) => {
    try {
      const fields = 'f57,f58,f43,f59,f169,f170,f124';
      const json = await fetchEastmoney(`/api/qt/stock/get?secid=${secid}&fields=${fields}`);
      const row = json?.data;
      if (!row?.f58) return null;
      const precision = Number(row.f59) || 2;
      const divisor = 10 ** precision;
      return [secid, {
        secid,
        code: String(row.f57 || secid.split('.')[1]),
        name: row.f58,
        price: Number(row.f43) / divisor,
        percent: Number(row.f170) / 100,
        change: Number(row.f169) / divisor,
        trend: [],
        timestamp: Number(row.f124) > 0 ? Number(row.f124) * 1000 : 0,
        source: '东方财富',
      }];
    } catch {
      return null;
    }
  }));
  return new Map(entries.filter(Boolean));
}

function chooseVerifiedQuote(candidates) {
  const valid = candidates.filter((item) => item && Number.isFinite(item.price) && item.price > 0);
  if (!valid.length) return null;
  const sortedPrices = valid.map((item) => item.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const reliable = valid.filter((item) => valid.length < 3 || Math.abs(item.price - median) / median < .012);
  const priority = { '腾讯': 3, '新浪': 2, '东方财富': 1 };
  reliable.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || (priority[b.source] || 0) - (priority[a.source] || 0));
  const selected = reliable[0];
  return { ...selected, sources: reliable.map((item) => item.source), sourceCount: reliable.length };
}

async function getMarketSnapshot(requested, includeTrend = true) {
  const secids = sanitizeSecids(requested);
  if (!secids.length) return { items: [], updatedAt: Date.now(), sources: [] };
  const [tencentResult, sinaResult, eastmoneyResult] = await Promise.allSettled([
    getTencentQuotes(secids, includeTrend),
    getSinaQuotes(secids),
    getEastmoneyQuotes(secids),
  ]);
  const tencent = tencentResult.status === 'fulfilled' ? tencentResult.value : new Map();
  const sina = sinaResult.status === 'fulfilled' ? sinaResult.value : new Map();
  const eastmoney = eastmoneyResult.status === 'fulfilled' ? eastmoneyResult.value : new Map();
  const items = secids.map((secid) => {
    const selected = chooseVerifiedQuote([tencent.get(secid), sina.get(secid), eastmoney.get(secid)]);
    if (!selected) return null;
    const trend = tencent.get(secid)?.trend || selected.trend || [];
    return { ...selected, trend };
  }).filter(Boolean);
  if (!items.length) throw new Error('实时行情源均不可用');
  return { items, updatedAt: Date.now(), sources: ['腾讯', '东方财富', '新浪'] };
}

function mapCandleRows(rows) {
  return rows.map((row) => ({
    time: String(row[0]),
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
  })).filter((item) => [item.open, item.close, item.high, item.low, item.volume].every(Number.isFinite));
}

async function getTencentKline(secid, period) {
  const symbol = tencentSymbol(secid);
  let rows;
  if (period === 'm60') {
    const text = await fetchTencent(`https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},m60,,160`);
    const json = JSON.parse(text);
    rows = json?.data?.[symbol]?.m60 || [];
  } else {
    const text = await fetchTencent(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,160,qfq`);
    const json = JSON.parse(text);
    rows = json?.data?.[symbol]?.[`qfq${period}`] || json?.data?.[symbol]?.[period] || [];
  }
  const candles = mapCandleRows(rows);
  if (!candles.length) throw new Error('腾讯 K 线不可用');
  return { candles, source: '腾讯' };
}

function aggregateCandles(candles, period) {
  if (period === 'day' || period === 'm60') return candles;
  const groups = new Map();
  for (const candle of candles) {
    const dateText = candle.time.slice(0, 10);
    let key = dateText.slice(0, 7);
    if (period === 'week') {
      const date = new Date(`${dateText}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
    }
    const group = groups.get(key);
    if (!group) groups.set(key, { ...candle });
    else {
      group.close = candle.close;
      group.high = Math.max(group.high, candle.high);
      group.low = Math.min(group.low, candle.low);
      group.volume += candle.volume;
      group.time = candle.time;
    }
  }
  return [...groups.values()];
}

async function getSinaKline(secid, period) {
  const symbol = tencentSymbol(secid);
  const scale = period === 'm60' ? 60 : 240;
  const count = period === 'm60' ? 180 : 700;
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${count}`;
  const rows = await fetchJson(url, { headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' } });
  const daily = (Array.isArray(rows) ? rows : []).map((row) => ({
    time: String(row.day), open: Number(row.open), close: Number(row.close), high: Number(row.high), low: Number(row.low), volume: Number(row.volume),
  })).filter((item) => [item.open, item.close, item.high, item.low, item.volume].every(Number.isFinite));
  const candles = aggregateCandles(daily, period).slice(-160);
  if (!candles.length) throw new Error('新浪 K 线不可用');
  return { candles, source: '新浪' };
}

async function getKlineSnapshot(secidInput, periodInput = 'day') {
  const secid = sanitizeSecids([secidInput])[0];
  if (!secid) throw new Error('股票代码无效');
  const period = ['m60', 'day', 'week', 'month'].includes(periodInput) ? periodInput : 'day';
  const results = await Promise.allSettled([getTencentKline(secid, period), getSinaKline(secid, period)]);
  const available = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!available.length) throw new Error('K 线数据源均不可用');
  const selected = available.find((item) => item.source === '腾讯') || available[0];
  return { secid, period, candles: selected.candles, source: selected.source, sources: available.map((item) => item.source), updatedAt: Date.now() };
}

async function getMinuteFundFlow(secid) {
  const params = new URLSearchParams({ lmt: '0', klt: '1', secid, fields1: 'f1,f2,f3,f7', fields2: 'f51,f52,f53,f54,f55,f56' });
  const json = await fetchEastmoney(`/api/qt/stock/fflow/kline/get?${params}`);
  const points = (json?.data?.klines || []).map((line) => {
    const [time, main, small, medium, large, superLarge] = String(line).split(',');
    return { time, main: Number(main), superLarge: Number(superLarge), large: Number(large), medium: Number(medium), small: Number(small) };
  }).filter((point) => [point.main, point.superLarge, point.large, point.medium, point.small].every(Number.isFinite));
  if (!points.length) throw new Error('资金流数据暂不可用');
  return { name: json.data.name || secid.split('.')[1], points };
}

async function getDailyFundFlow(secid) {
  const params = new URLSearchParams({ lmt: '90', klt: '101', secid, fields1: 'f1,f2,f3,f7', fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63' });
  let json;
  let lastError;
  const pathAndQuery = `/api/qt/stock/fflow/daykline/get?${params}`;
  const historyUrl = `https://push2his.eastmoney.com${pathAndQuery}`;
  try {
    json = await fetchJson(`https://push2test.eastmoney.com${pathAndQuery}`, {
      headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!json?.data?.klines?.length) throw new Error('历史资金流为空');
  } catch (error) {
    lastError = error;
    try {
      json = await fetchEastmoney(pathAndQuery);
      if (!json?.data?.klines?.length) throw new Error('历史资金流为空');
    } catch {
      try { json = await fetchCurlJson(historyUrl); } catch (curlError) { lastError = curlError; }
    }
  }
  const daily = (json?.data?.klines || []).map((line) => {
    const [date, main, small, medium, large, superLarge, mainPercent, smallPercent, mediumPercent, largePercent, superLargePercent, price, percent] = String(line).split(',');
    const parsed = {
      date,
      main: Number(main),
      superLarge: Number(superLarge),
      large: Number(large),
      medium: Number(medium),
      small: Number(small),
      net: Number(main) + Number(medium),
      price: Number(price),
      percent: Number(percent),
      mainPercent: Number(mainPercent),
      superLargePercent: Number(superLargePercent),
      largePercent: Number(largePercent),
      mediumPercent: Number(mediumPercent),
      smallPercent: Number(smallPercent),
    };
    return parsed;
  }).filter((point) => [point.main, point.superLarge, point.large, point.medium, point.small, point.net, point.price].every(Number.isFinite));
  if (!daily.length) throw lastError || new Error('历史资金流数据暂不可用');
  return { name: json.data.name || secid.split('.')[1], daily };
}

async function getFundFlow(secidInput) {
  const secid = sanitizeSecids([secidInput])[0];
  if (!secid) throw new Error('股票代码无效');
  const dailyResult = await Promise.resolve(getDailyFundFlow(secid)).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  const minuteResult = await Promise.resolve(getMinuteFundFlow(secid)).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  if (minuteResult.status === 'rejected') debugLog('Minute fund flow failed', minuteResult.reason?.message);
  if (dailyResult.status === 'rejected') debugLog('Daily fund flow failed', dailyResult.reason?.message);
  if (minuteResult.status === 'rejected' && dailyResult.status === 'rejected') throw new Error('资金流数据暂不可用');
  const minute = minuteResult.status === 'fulfilled' ? minuteResult.value : null;
  const history = dailyResult.status === 'fulfilled' ? dailyResult.value : null;
  return {
    secid,
    name: minute?.name || history?.name || secid.split('.')[1],
    points: minute?.points || [],
    daily: history?.daily || [],
    source: '东方财富',
    updatedAt: Date.now(),
  };
}

function showHoldingNotification(item, direction, threshold) {
  const rising = direction === 'up';
  const signedThreshold = rising ? threshold : -threshold;
  const message = `${item.name} ${formatSignedPercent(item.percent)}，已${rising ? '涨至' : '跌至'}提醒线 ${formatSignedPercent(signedThreshold)}`;
  const payload = { secid: item.secid, direction, message, percent: item.percent, price: item.price, threshold: signedThreshold };
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('holding:alert', payload);
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    id: `floatdeck-${item.secid}-${direction}`,
    groupId: 'com.floatdeck.desktop.holdings',
    title: `${item.name} · ${rising ? '涨幅' : '跌幅'}提醒`,
    subtitle: `${item.code}  当前价 ¥${Number(item.price).toFixed(2)}`,
    body: `当前涨跌幅 ${formatSignedPercent(item.percent)}（阈值 ${formatSignedPercent(signedThreshold)}）`,
    sound: 'default',
  });
  activeNotifications.add(notification);
  notification.on('click', () => {
    showWindow();
    windowRef?.webContents.send('holding:alert', payload);
  });
  const release = () => activeNotifications.delete(notification);
  notification.once('close', release);
  notification.once('failed', release);
  notification.show();
}

function formatSignedPercent(value) {
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function shanghaiMarketClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isAShareTradingWindow(now = new Date()) {
  const clock = shanghaiMarketClock(now);
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(clock.weekday)) return false;
  return (clock.minutes >= 9 * 60 + 25 && clock.minutes <= 11 * 60 + 35)
    || (clock.minutes >= 12 * 60 + 55 && clock.minutes <= 15 * 60 + 5);
}

function isFreshAlertQuote(item, now = Date.now()) {
  const timestamp = Number(item?.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const age = now - timestamp;
  return age >= -60_000 && age <= settings.alertMaxQuoteAgeSeconds * 1000;
}

function updateHoldingAlertStatus(patch) {
  holdingAlertStatus = { ...holdingAlertStatus, ...patch };
  emitHoldingAlertStatus();
}

async function checkHoldingAlerts() {
  if (holdingAlertInFlight || isQuitting) return;
  const enabled = settings.holdings.filter((holding) => holding.alertEnabled);
  const checkedAt = Date.now();
  if (!enabled.length) {
    updateHoldingAlertStatus({ lastCheckAt: checkedAt, lastError: null, skippedReason: 'no-enabled-holdings', enabledCount: 0, freshCount: 0, staleCount: 0 });
    return;
  }
  if (settings.alertTradingHoursOnly && !isAShareTradingWindow()) {
    updateHoldingAlertStatus({ lastCheckAt: checkedAt, lastError: null, skippedReason: 'outside-trading-hours', enabledCount: enabled.length, freshCount: 0, staleCount: 0 });
    return;
  }
  holdingAlertInFlight = true;
  updateHoldingAlertStatus({ lastCheckAt: checkedAt, lastError: null, skippedReason: null, enabledCount: enabled.length, freshCount: 0, staleCount: 0 });
  try {
    const snapshot = await getMarketSnapshot(enabled.map((holding) => holding.secid), false);
    const byId = new Map(snapshot.items.map((item) => [item.secid, item]));
    const freshIds = new Set(snapshot.items.filter((item) => isFreshAlertQuote(item)).map((item) => item.secid));
    let stateChanged = false;
    for (const holding of enabled) {
      const item = byId.get(holding.secid);
      if (!item || !freshIds.has(holding.secid) || !Number.isFinite(item.percent)) continue;
      const currentState = holdingAlertStates[holding.secid] || { upActive: false, downActive: false };
      const nextState = { ...currentState };

      if (item.percent >= holding.alertUp && !currentState.upActive) {
        nextState.upActive = true;
        showHoldingNotification(item, 'up', holding.alertUp);
      } else if (item.percent < holding.alertUp - 0.15 && currentState.upActive) {
        nextState.upActive = false;
      }

      if (item.percent <= -holding.alertDown && !currentState.downActive) {
        nextState.downActive = true;
        showHoldingNotification(item, 'down', holding.alertDown);
      } else if (item.percent > -holding.alertDown + 0.15 && currentState.downActive) {
        nextState.downActive = false;
      }

      if (nextState.upActive !== currentState.upActive || nextState.downActive !== currentState.downActive || !holdingAlertStates[holding.secid]) {
        holdingAlertStates[holding.secid] = nextState;
        stateChanged = true;
      }
    }
    if (stateChanged) persistHoldingAlertStates();
    updateHoldingAlertStatus({ lastSuccessAt: Date.now(), lastError: null, skippedReason: freshIds.size ? null : 'stale-quotes', freshCount: freshIds.size, staleCount: enabled.length - freshIds.size });
  } catch (error) {
    debugLog('Holding alert poll failed', error.message);
    updateHoldingAlertStatus({ lastError: error.message, skippedReason: 'source-error', freshCount: 0, staleCount: enabled.length });
  } finally {
    holdingAlertInFlight = false;
  }
}

function startHoldingAlertMonitor() {
  clearInterval(holdingAlertTimer);
  clearTimeout(holdingAlertKickTimer);
  holdingAlertStatus.running = true;
  emitHoldingAlertStatus();
  holdingAlertKickTimer = setTimeout(checkHoldingAlerts, 8000);
  holdingAlertTimer = setInterval(checkHoldingAlerts, settings.alertPollIntervalSeconds * 1000);
}

const weatherCodes = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '小毛雨', 53: '毛毛雨', 55: '强毛雨', 56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨冰雹', 99: '强雷雨冰雹',
};

async function getWeather(input) {
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  const located = input && typeof input === 'object' && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  let place;
  if (located) {
    place = { latitude, longitude, name: '当前位置', admin1: '', timezone: 'auto' };
  } else {
    const city = String(typeof input === 'string' ? input : input?.city || '上海').trim().slice(0, 40) || '上海';
    const geocode = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' })}`);
    place = geocode?.results?.[0];
    if (!place) throw new Error(`没有找到城市“${city}”`);
  }

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: place.timezone || 'auto',
    forecast_days: '7',
  });
  const forecast = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const current = forecast.current;
  return {
    city: place.name,
    region: place.admin1 || place.country || '',
    source: located ? 'location' : 'city',
    temperature: Math.round(current.temperature_2m),
    apparent: Math.round(current.apparent_temperature),
    humidity: Math.round(current.relative_humidity_2m),
    wind: Math.round(current.wind_speed_10m),
    code: current.weather_code,
    condition: weatherCodes[current.weather_code] || '天气变化',
    isDay: Boolean(current.is_day),
    daily: forecast.daily.time.map((date, index) => ({
      date,
      code: forecast.daily.weather_code[index],
      condition: weatherCodes[forecast.daily.weather_code[index]] || '变化',
      high: Math.round(forecast.daily.temperature_2m_max[index]),
      low: Math.round(forecast.daily.temperature_2m_min[index]),
      rain: Math.round(forecast.daily.precipitation_probability_max[index] || 0),
    })),
    updatedAt: Date.now(),
  };
}

function saveAiConfig(config) {
  const endpoint = String(config?.endpoint || settings.aiEndpoint).trim().replace(/\/+$/, '');
  const model = String(config?.model || settings.aiModel).trim();
  const prompt = String(config?.prompt || settings.aiPrompt).trim();
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error('AI 接口地址无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('AI 接口仅支持 HTTP 或 HTTPS');
  if (!model) throw new Error('请填写 AI 模型名称');
  if (!prompt) throw new Error('请填写研判提示词');
  settings = normalizeSettings({
    ...settings,
    aiEndpoint: endpoint,
    aiModel: model,
    aiPrompt: prompt,
    aiRoleId: config?.roleId || settings.aiRoleId,
    aiTaskId: config?.taskId || settings.aiTaskId,
  });
  if (config?.clearKey) settings.aiApiKeyCipher = '';
  else if (String(config?.apiKey || '').trim()) settings.aiApiKeyCipher = encryptAiApiKey(config.apiKey);
  persistSettings();
  return publicSettings();
}

function aiCompletionUrl(endpoint) {
  const base = String(endpoint).replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function aiModelsUrl(endpoint) {
  const url = new URL(String(endpoint).trim());
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/chat\/completions$/i, '').replace(/\/responses$/i, '');
  if (!/\/models$/i.test(pathname)) pathname = `${pathname}/models`;
  url.pathname = pathname;
  return url.toString();
}

function normalizeAvailableModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  const unique = new Map();
  const nonChatPattern = /(embedding|whisper|tts|speech|dall[-_.]?e|moderation|realtime|image|audio|transcri|rerank)/i;
  for (const row of rows) {
    const id = String(typeof row === 'string' ? row : row?.id || row?.model || row?.name || '').trim();
    if (!id || unique.has(id)) continue;
    unique.set(id, {
      id,
      name: String(typeof row === 'string' ? row : row?.display_name || row?.displayName || row?.name || id).trim() || id,
      ownedBy: String(typeof row === 'string' ? '' : row?.owned_by || row?.ownedBy || row?.provider || '').trim(),
      chatCompatible: !nonChatPattern.test(id),
    });
  }
  return [...unique.values()].sort((left, right) => Number(right.chatCompatible) - Number(left.chatCompatible) || left.id.localeCompare(right.id)).slice(0, 300);
}

async function testAiConnection(config) {
  const endpoint = String(config?.endpoint || settings.aiEndpoint).trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error('AI 接口地址无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('AI 接口仅支持 HTTP 或 HTTPS');
  const apiKey = String(config?.apiKey || '').trim() || decryptAiApiKey();
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (!apiKey && !local) throw new Error('请填写 API Key 后再测试连接');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await net.fetch(aiModelsUrl(endpoint), { headers, signal: controller.signal });
    const raw = await response.text();
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`模型列表返回了无法解析的数据（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(json?.error?.message || json?.message || `连接测试失败（HTTP ${response.status}）`);
    const models = normalizeAvailableModels(json);
    if (!models.length) throw new Error('接口鉴权成功，但没有返回可用模型；可保留手动模型名称');
    return { ok: true, endpoint, provider: parsed.hostname, models, testedAt: Date.now() };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('连接测试超时，请检查接口地址或网络');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callConfiguredAi(messages) {
  const endpoint = aiCompletionUrl(settings.aiEndpoint);
  const apiKey = decryptAiApiKey();
  const hostname = new URL(endpoint).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!apiKey && !local) throw new Error('请先在设置中配置 API Key');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  try {
    const body = { model: settings.aiModel, messages };
    if (hostname === 'api.openai.com') body.store = false;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await net.fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`AI 接口返回了无法解析的数据（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(json?.error?.message || `AI 请求失败（HTTP ${response.status}）`);
    const content = json?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((item) => item?.text || '').join('\n') : String(content || '');
    if (!text.trim()) throw new Error('AI 没有返回研判内容');
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function quoteEvidence(quote) {
  if (!quote) return null;
  return {
    secid: quote.secid,
    code: quote.code,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    percent: quote.percent,
    source: quote.source,
    verifiedSources: quote.sources,
    sourceCount: quote.sourceCount,
    timestamp: quote.timestamp,
  };
}

async function collectStockAgentEvidence(secidInput, toolIds) {
  const secid = sanitizeSecids([secidInput])[0];
  if (!secid) throw new Error('股票代码无效');
  const tools = new Set(toolIds);
  const [marketResult, klineResult, flowResult] = await Promise.allSettled([
    tools.has('realtime-quote') ? getMarketSnapshot([secid], false) : Promise.resolve(null),
    tools.has('daily-kline') ? getKlineSnapshot(secid, 'day') : Promise.resolve(null),
    tools.has('fund-flow') ? getFundFlow(secid) : Promise.resolve(null),
  ]);
  const quote = marketResult.status === 'fulfilled' ? marketResult.value?.items?.[0] : null;
  const kline = klineResult.status === 'fulfilled' ? klineResult.value : null;
  const flow = flowResult.status === 'fulfilled' ? flowResult.value : null;
  if (!quote && !kline && !flow) throw new Error('缺少任务所需的行情数据，暂时无法研判');
  const holding = tools.has('holding-context') ? settings.holdings.find((item) => item.secid === secid) || null : null;
  return {
    secid,
    title: quote?.name || secid.split('.')[1],
    evidence: {
    generatedAt: new Date().toISOString(),
    agentScope: '当前个股，不代表全市场',
    quote: tools.has('realtime-quote') ? quoteEvidence(quote) : undefined,
    recentDailyCandles: tools.has('daily-kline') ? kline?.candles.slice(-40) || [] : undefined,
    klineSources: tools.has('daily-kline') ? kline?.sources || [] : undefined,
    intradayFundFlow: tools.has('fund-flow') && flow ? { source: flow.source, latest: flow.points.at(-1), recent: flow.points.slice(-30) } : undefined,
    recentDailyFundFlow: tools.has('fund-flow') ? flow?.daily?.slice(-40) || [] : undefined,
    holding: holding && quote ? {
      shares: holding.shares,
      costPrice: holding.costPrice,
      marketValue: quote.price * holding.shares,
      profit: (quote.price - holding.costPrice) * holding.shares,
      profitPercent: (quote.price - holding.costPrice) / holding.costPrice * 100,
      alertUp: holding.alertUp,
      alertDown: holding.alertDown,
    } : null,
    },
  };
}

async function collectMarketAgentEvidence(toolIds) {
  const tools = new Set(toolIds);
  const observedSecids = tools.has('watchlist') ? sanitizeSecids([...settings.watchlist, ...settings.holdings.map((holding) => holding.secid)]).slice(0, 12) : [];
  const market = await getMarketSnapshot([...MARKET_INDEX_SECIDS, ...observedSecids], false);
  const quoteById = new Map(market.items.map((item) => [item.secid, item]));
  const indexDetails = await Promise.all(MARKET_INDEX_SECIDS.map(async (secid) => {
    const [klineResult, flowResult] = await Promise.allSettled([
      tools.has('daily-kline') ? getKlineSnapshot(secid, 'day') : Promise.resolve(null),
      tools.has('fund-flow') ? getFundFlow(secid) : Promise.resolve(null),
    ]);
    const kline = klineResult.status === 'fulfilled' ? klineResult.value : null;
    const flow = flowResult.status === 'fulfilled' ? flowResult.value : null;
    return {
      quote: quoteEvidence(quoteById.get(secid)),
      recentDailyCandles: tools.has('daily-kline') ? kline?.candles.slice(-30) || [] : undefined,
      klineSources: tools.has('daily-kline') ? kline?.sources || [] : undefined,
      latestIntradayFundFlow: tools.has('fund-flow') ? flow?.points.at(-1) || null : undefined,
      recentDailyFundFlow: tools.has('fund-flow') ? flow?.daily.slice(-20) || [] : undefined,
    };
  }));
  const observedQuotes = observedSecids.map((secid) => quoteById.get(secid)).filter(Boolean);
  return {
    secid: 'market',
    title: '今日大盘',
    evidence: {
      generatedAt: new Date().toISOString(),
      agentScope: '三大指数；用户自选仅作观察样本，不代表全市场宽度',
      indices: indexDetails,
      userObservedUniverse: tools.has('watchlist') ? {
        sampleSize: observedQuotes.length,
        rising: observedQuotes.filter((item) => item.percent > 0).length,
        falling: observedQuotes.filter((item) => item.percent < 0).length,
        unchanged: observedQuotes.filter((item) => item.percent === 0).length,
        quotes: observedQuotes.map(quoteEvidence),
      } : undefined,
    },
  };
}

async function collectPortfolioAgentEvidence(toolIds) {
  if (!settings.holdings.length) throw new Error('请先在持仓页面录入持仓，再运行持仓研判任务');
  const tools = new Set(toolIds);
  const holdingSecids = settings.holdings.map((holding) => holding.secid);
  const contextSecids = tools.has('market-indices') ? MARKET_INDEX_SECIDS : [];
  const market = await getMarketSnapshot([...contextSecids, ...holdingSecids], false);
  const quoteById = new Map(market.items.map((item) => [item.secid, item]));
  const positions = settings.holdings.map((holding) => {
    const quote = quoteById.get(holding.secid);
    if (!quote) return { ...holding, quote: null };
    const marketValue = quote.price * holding.shares;
    const costValue = holding.costPrice * holding.shares;
    const previousValue = marketValue / Math.max(1 + quote.percent / 100, .001);
    return {
      secid: holding.secid,
      code: quote.code,
      name: quote.name,
      shares: holding.shares,
      costPrice: holding.costPrice,
      price: quote.price,
      todayPercent: quote.percent,
      marketValue,
      costValue,
      profit: marketValue - costValue,
      profitPercent: (quote.price - holding.costPrice) / holding.costPrice * 100,
      estimatedTodayPnl: marketValue - previousValue,
      alertUp: holding.alertUp,
      alertDown: holding.alertDown,
      verifiedSources: quote.sources,
    };
  });
  const priced = positions.filter((position) => Number.isFinite(position.marketValue));
  const totalMarketValue = priced.reduce((sum, position) => sum + position.marketValue, 0);
  const totalCostValue = priced.reduce((sum, position) => sum + position.costValue, 0);
  const estimatedTodayPnl = priced.reduce((sum, position) => sum + position.estimatedTodayPnl, 0);
  const weighted = priced.map((position) => ({ ...position, weight: totalMarketValue ? position.marketValue / totalMarketValue * 100 : 0 })).sort((a, b) => b.weight - a.weight);
  const detailedSignals = tools.has('portfolio-signals') ? await Promise.all(weighted.slice(0, 6).map(async (position) => {
    const [klineResult, flowResult] = await Promise.allSettled([getKlineSnapshot(position.secid, 'day'), getDailyFundFlow(position.secid)]);
    return {
      secid: position.secid,
      name: position.name,
      weight: position.weight,
      recentDailyCandles: klineResult.status === 'fulfilled' ? klineResult.value.candles.slice(-25) : [],
      recentDailyFundFlow: flowResult.status === 'fulfilled' ? flowResult.value.daily.slice(-15) : [],
    };
  })) : [];
  return {
    secid: 'portfolio',
    title: '我的持仓',
    evidence: {
      generatedAt: new Date().toISOString(),
      agentScope: '仅分析已录入持仓，不知道用户仓外现金和其他资产',
      marketContext: tools.has('market-indices') ? MARKET_INDEX_SECIDS.map((secid) => quoteEvidence(quoteById.get(secid))) : undefined,
      portfolioSummary: {
        positionCount: settings.holdings.length,
        pricedPositionCount: priced.length,
        totalMarketValue,
        totalCostValue,
        totalProfit: totalMarketValue - totalCostValue,
        totalProfitPercent: totalCostValue ? (totalMarketValue - totalCostValue) / totalCostValue * 100 : 0,
        estimatedTodayPnl,
      },
      positions: weighted,
      unavailablePositions: positions.filter((position) => !Number.isFinite(position.marketValue)),
      detailedSignals,
    },
  };
}

async function analyzeWithAgent(request) {
  const normalized = typeof request === 'string' ? { taskId: 'stock-multifactor', secid: request } : request || {};
  const legacyTaskByAgent = { market: 'market-review', stock: 'stock-multifactor', portfolio: 'portfolio-review' };
  const requestedTaskId = normalized.taskId || legacyTaskByAgent[normalized.agent] || settings.aiTaskId;
  const requestedRoleId = normalized.roleId || AI_TASKS.find((item) => item.id === requestedTaskId)?.roleId || settings.aiRoleId;
  const role = AI_SYSTEM_ROLES.find((item) => item.id === requestedRoleId) || AI_SYSTEM_ROLES.find((item) => item.id === settings.aiRoleId) || AI_SYSTEM_ROLES[0];
  const task = AI_TASKS.find((item) => item.id === requestedTaskId && item.roleId === role.id) || AI_TASKS.find((item) => item.roleId === role.id);
  if (!task) throw new Error('所选系统角色没有可执行的研判任务');
  const collected = task.scope === 'market'
    ? await collectMarketAgentEvidence(task.toolIds)
    : task.scope === 'portfolio'
      ? await collectPortfolioAgentEvidence(task.toolIds)
      : await collectStockAgentEvidence(normalized.secid || settings.selectedSecid, task.toolIds);
  const additionalPrompt = String(settings.aiPrompt || '').trim();
  const outputContract = task.outputSections.map((section, index) => `${index + 1}. ${section}`).join('\n');
  const systemPrompt = `${AI_COMMON_PROMPT}\n\n【研判系统角色：${role.name}】\n${role.prompt}\n\n【研判任务模板：${task.name}】\n${task.prompt}\n\n【适用范围】\n${task.applicability}\n\n【固定输出结构】\n${outputContract}${additionalPrompt ? `\n\n【用户附加要求】\n${additionalPrompt}` : ''}`;
  const executionContract = {
    model: { id: 'primary', endpoint: settings.aiEndpoint, model: settings.aiModel },
    role: { id: role.id, code: role.code, name: role.name },
    task: { id: task.id, code: task.code, name: task.name, scope: task.scope },
    tools: task.toolIds.map((id) => AI_TOOLS.find((tool) => tool.id === id)).filter(Boolean),
    outputSections: task.outputSections,
    applicability: task.applicability,
  };
  const content = await callConfiguredAi([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是本次研判的执行契约，以及内置工具按契约采集的结构化证据。只使用 evidence 中实际存在的数据。\n\n${JSON.stringify({ executionContract, evidence: collected.evidence })}` },
  ]);
  const analysis = {
    id: `${Date.now()}-${task.id}-${collected.secid}`,
    secid: collected.secid,
    scope: task.scope,
    roleId: role.id,
    roleName: role.name,
    taskId: task.id,
    taskName: task.name,
    title: collected.title,
    model: settings.aiModel,
    toolIds: task.toolIds,
    outputSections: task.outputSections,
    content,
    updatedAt: Date.now(),
  };
  return saveAiAnalysisToHistory(analysis);
}

ipcMain.handle('app:bootstrap', async () => ({ settings: publicSettings(), aiCatalog: publicAiCatalog(), aiHistory: aiAnalysisHistory, alertStatus: publicHoldingAlertStatus() }));
ipcMain.handle('codex:usage', async () => {
  if (process.env.FLOATDECK_CAPTURE_PATH) {
    return {
      connected: true,
      planType: 'demo',
      primary: { usedPercent: 77, windowDurationMins: 10_080, resetsAt: Math.floor(Date.now() / 1000) + 6 * 86_400 + 17 * 3_600 },
      updatedAt: Date.now(),
    };
  }
  try {
    const result = await codexServer.getUsage();
    updateTrayPresentation(result);
    debugLog('Codex usage loaded', result.primary?.usedPercent);
    return result;
  } catch (error) {
    debugLog('Codex usage failed', error.message);
    const result = { connected: false, error: error.message, updatedAt: Date.now() };
    updateTrayPresentation(result);
    return result;
  }
});
ipcMain.handle('market:snapshot', async (_event, secids) => {
  const result = await getMarketSnapshot(secids);
  debugLog('Market loaded', result.items.length);
  return result;
});
ipcMain.handle('market:kline', async (_event, secid, period) => {
  const result = await getKlineSnapshot(secid, period);
  debugLog('Kline loaded', result.secid, result.period, result.candles.length);
  return result;
});
ipcMain.handle('market:fund-flow', async (_event, secid) => {
  const result = await getFundFlow(secid);
  debugLog('Fund flow loaded', result.secid, result.points.length);
  return result;
});
ipcMain.handle('weather:forecast', async (_event, city) => {
  const result = await getWeather(city);
  debugLog('Weather loaded', result.city);
  return result;
});
ipcMain.handle('settings:update', async (_event, patch) => updateSettings(patch && typeof patch === 'object' ? patch : {}));
ipcMain.handle('ai:config', async (_event, config) => saveAiConfig(config && typeof config === 'object' ? config : {}));
ipcMain.handle('ai:test-connection', async (_event, config) => testAiConnection(config && typeof config === 'object' ? config : {}));
ipcMain.handle('ai:analyze', async (_event, request) => analyzeWithAgent(request));
ipcMain.handle('ai:history', async () => aiAnalysisHistory);
ipcMain.handle('ai:history:remove', async (_event, id) => removeAiAnalysisFromHistory(id));
ipcMain.handle('ai:history:clear', async () => clearAiAnalysisHistory());
ipcMain.handle('holding:alert-status', async () => publicHoldingAlertStatus());
ipcMain.handle('clipboard:write', async (_event, value) => { clipboard.writeText(String(value || '').slice(0, 250_000)); return true; });
ipcMain.handle('window:panel', async (_event, panel) => {
  const requested = PANEL_SIZES[panel] || PANEL_SIZES.closed;
  if (windowRef) {
    const current = windowRef.getBounds();
    if (requested.width > PANEL_SIZES.closed.width && current.width <= PANEL_SIZES.closed.width) compactPosition = { x: current.x, y: current.y };
    const display = screen.getDisplayMatching(current);
    const area = display.workArea;
    const width = Math.min(requested.width, area.width);
    const height = Math.min(requested.height, area.height);
    const preferred = panel === 'closed' && compactPosition ? compactPosition : current;
    const x = Math.max(area.x, Math.min(preferred.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(preferred.y, area.y + area.height - height));
    windowRef.setBounds({ x, y, width, height }, true);
    if (panel === 'closed') compactPosition = null;
  }
  return requested.height;
});
ipcMain.on('window:minimize', () => windowRef?.minimize());
ipcMain.on('window:hide', () => windowRef?.hide());
ipcMain.on('app:quit', () => { isQuitting = true; app.quit(); });

process.on('SIGUSR1', () => windowRef?.isVisible() ? windowRef.hide() : showWindow());
process.on('SIGUSR2', () => windowRef?.webContents.send('app:refresh'));
process.on('SIGHUP', () => { isQuitting = true; app.quit(); });

app.whenReady().then(() => {
  loadSettings();
  loadHoldingAlertStates();
  loadAiAnalysisHistory();
  if (process.env.FLOATDECK_CAPTURE_AI_HISTORY) {
    const sampleNow = Date.now();
    aiAnalysisHistory = sanitizeAiAnalysisHistory([
      { id: 'sample-1', secid: '0.300750', scope: 'stock', roleId: 'a-share-research', roleName: 'A股投研系统角色', taskId: 'stock-multifactor', taskName: '个股多因子分析', title: '宁德时代', model: settings.aiModel, toolIds: ['realtime-quote', 'daily-kline', 'fund-flow'], outputSections: ['核心结论', '趋势结构'], content: '短线仍处于震荡结构，资金与价格尚未形成一致性确认。', updatedAt: sampleNow - 18 * 60_000 },
      { id: 'sample-2', secid: 'market', scope: 'market', roleId: 'a-share-research', roleName: 'A股投研系统角色', taskId: 'market-review', taskName: 'A股盘前盘后复盘', title: '今日大盘', model: settings.aiModel, toolIds: ['market-indices', 'daily-kline'], outputSections: ['今日定性', '指数共振'], content: '三大指数分化，后续需要观察成交量能否继续改善。', updatedAt: sampleNow - 26 * 60 * 60_000 },
    ]);
  }
  applyLaunchAtLogin();
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'geolocation');
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'geolocation'));
  if (['glass', 'cozy', 'cyber'].includes(process.env.FLOATDECK_CAPTURE_THEME)) {
    settings.theme = process.env.FLOATDECK_CAPTURE_THEME;
  }
  if (process.env.FLOATDECK_CAPTURE_AI_ENDPOINT) settings.aiEndpoint = process.env.FLOATDECK_CAPTURE_AI_ENDPOINT;
  if (process.env.FLOATDECK_CAPTURE_SAMPLE_HOLDINGS) {
    settings.holdings = sanitizeHoldings([
      { secid: '0.300750', shares: 200, costPrice: 338.6, alertUp: 3, alertDown: 2.5, alertEnabled: true },
      { secid: '1.600519', shares: 100, costPrice: 1268.2, alertUp: 2, alertDown: 3, alertEnabled: false },
    ]);
  }
  if (/^[012]\.\d{6}$/.test(process.env.FLOATDECK_CAPTURE_SELECTED_SECID || '')) {
    settings.selectedSecid = process.env.FLOATDECK_CAPTURE_SELECTED_SECID;
  }
  if (process.env.FLOATDECK_CAPTURE_WEATHER_MANUAL) settings.weatherAuto = false;
  createWindow();
  if (process.platform === 'darwin') createMenuBarHelper();
  else createTray();
  if (!process.env.FLOATDECK_CAPTURE_PATH) startHoldingAlertMonitor();
  globalShortcut.register('CommandOrControl+Shift+U', () => windowRef?.isVisible() ? windowRef.hide() : showWindow());
  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
  holdingAlertStatus.running = false;
  clearInterval(holdingAlertTimer);
  clearTimeout(menuBarHelperRestartTimer);
  clearTimeout(holdingAlertKickTimer);
  menuBarHelperRef?.kill();
  menuBarHelperRef = null;
  codexServer.close();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

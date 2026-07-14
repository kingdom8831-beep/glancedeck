interface FloatDeckSettings {
  uiVersion: number;
  city: string;
  alwaysOnTop: boolean;
  allWorkspaces: boolean;
  opacity: number;
  theme: 'glass' | 'cozy' | 'cyber';
  weatherAuto: boolean;
  launchAtLogin: boolean;
  alertTradingHoursOnly: boolean;
  alertMaxQuoteAgeSeconds: number;
  alertPollIntervalSeconds: number;
  aiEndpoint: string;
  aiModel: string;
  aiPrompt: string;
  aiHasKey: boolean;
  aiRoleId: string;
  aiTaskId: string;
  selectedSecid: string;
  watchlist: string[];
  holdings: Holding[];
}

interface Holding {
  secid: string;
  shares: number;
  costPrice: number;
  alertUp: number;
  alertDown: number;
  alertEnabled: boolean;
}

interface HoldingAlert {
  secid: string;
  direction: 'up' | 'down';
  message: string;
  percent: number;
  price: number;
  threshold: number;
}

interface RateWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface CodexUsage {
  connected: boolean;
  planType?: string | null;
  limitName?: string;
  primary?: RateWindow | null;
  secondary?: RateWindow | null;
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | number | null } | null;
  error?: string;
  updatedAt: number;
}

interface MarketItem {
  secid: string;
  code: string;
  name: string;
  price: number;
  percent: number;
  change: number;
  trend: number[];
  source?: string;
  sources?: string[];
  sourceCount?: number;
  timestamp?: number;
}

interface MarketSnapshot {
  items: MarketItem[];
  updatedAt: number;
  sources?: string[];
}

interface KlineCandle {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface KlineSnapshot {
  secid: string;
  period: 'm60' | 'day' | 'week' | 'month';
  candles: KlineCandle[];
  source?: string;
  sources?: string[];
  updatedAt: number;
}

interface FundFlowPoint {
  time: string;
  main: number;
  superLarge: number;
  large: number;
  medium: number;
  small: number;
}

interface FundFlowDailyPoint {
  date: string;
  main: number;
  superLarge: number;
  large: number;
  medium: number;
  small: number;
  net: number;
  price: number;
  percent: number;
  mainPercent: number;
  superLargePercent: number;
  largePercent: number;
  mediumPercent: number;
  smallPercent: number;
}

interface FundFlowSnapshot {
  secid: string;
  name: string;
  points: FundFlowPoint[];
  daily: FundFlowDailyPoint[];
  source: string;
  updatedAt: number;
}

interface AiAnalysis {
  id: string;
  secid: string;
  scope: AiTaskScope;
  roleId: string;
  roleName: string;
  taskId: string;
  taskName: string;
  title: string;
  model: string;
  toolIds: string[];
  outputSections: string[];
  content: string;
  updatedAt: number;
}

interface HoldingAlertStatus {
  running: boolean;
  lastCheckAt: number;
  lastSuccessAt: number;
  lastError: string | null;
  skippedReason: 'starting' | 'no-enabled-holdings' | 'outside-trading-hours' | 'stale-quotes' | 'source-error' | null;
  enabledCount: number;
  freshCount: number;
  staleCount: number;
  tradingHoursOnly: boolean;
  pollIntervalSeconds: number;
  maxQuoteAgeSeconds: number;
}

type AiTaskScope = 'market' | 'stock' | 'portfolio';

interface AiModelSummary {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  model: string;
  configured: boolean;
}

interface AiSystemRole {
  id: string;
  code: string;
  name: string;
  description: string;
}

interface AiTaskTemplate {
  id: string;
  roleId: string;
  code: string;
  name: string;
  scope: AiTaskScope;
  description: string;
  applicability: string;
  toolIds: string[];
  outputSections: string[];
}

interface AiToolDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
}

interface AiCatalog {
  models: AiModelSummary[];
  roles: AiSystemRole[];
  tasks: AiTaskTemplate[];
  tools: AiToolDefinition[];
}

interface AiAnalyzeInput {
  modelId: string;
  roleId: string;
  taskId: string;
  secid?: string;
}

interface AiConfigInput {
  endpoint: string;
  model: string;
  prompt: string;
  roleId: string;
  taskId: string;
  apiKey?: string;
  clearKey?: boolean;
}

interface AiConnectionTestInput {
  endpoint: string;
  apiKey?: string;
}

interface AiAvailableModel {
  id: string;
  name: string;
  ownedBy: string;
  chatCompatible: boolean;
}

interface AiConnectionTestResult {
  ok: true;
  endpoint: string;
  provider: string;
  models: AiAvailableModel[];
  testedAt: number;
}

interface WeatherQuery {
  city?: string;
  latitude?: number;
  longitude?: number;
}

interface WeatherData {
  city: string;
  region: string;
  source: 'location' | 'city';
  temperature: number;
  apparent: number;
  humidity: number;
  wind: number;
  code: number;
  condition: string;
  isDay: boolean;
  daily: Array<{ date: string; code: number; condition: string; high: number; low: number; rain: number }>;
  updatedAt: number;
}

interface Window {
  floatdeck: {
    getBootstrap: () => Promise<{ settings: FloatDeckSettings; aiCatalog: AiCatalog; aiHistory: AiAnalysis[]; alertStatus: HoldingAlertStatus }>;
    refreshCodex: () => Promise<CodexUsage>;
    refreshMarket: (secids: string[]) => Promise<MarketSnapshot>;
    refreshKline: (secid: string, period: 'm60' | 'day' | 'week' | 'month') => Promise<KlineSnapshot>;
    refreshFundFlow: (secid: string) => Promise<FundFlowSnapshot>;
    refreshWeather: (query: string | WeatherQuery) => Promise<WeatherData>;
    saveSettings: (patch: Partial<FloatDeckSettings>) => Promise<FloatDeckSettings>;
    saveAiConfig: (config: AiConfigInput) => Promise<FloatDeckSettings>;
    testAiConnection: (config: AiConnectionTestInput) => Promise<AiConnectionTestResult>;
    analyzeStock: (request: AiAnalyzeInput) => Promise<AiAnalysis>;
    getAiHistory: () => Promise<AiAnalysis[]>;
    removeAiHistory: (id: string) => Promise<AiAnalysis[]>;
    clearAiHistory: () => Promise<AiAnalysis[]>;
    getAlertStatus: () => Promise<HoldingAlertStatus>;
    copyText: (value: string) => Promise<boolean>;
    resizePanel: (panel: 'closed' | 'stocks' | 'holdings' | 'settings' | 'weather' | 'chart') => Promise<number>;
    minimize: () => void;
    hide: () => void;
    quit: () => void;
    onRefreshRequested: (callback: () => void) => () => void;
    onHoldingAlert: (callback: (alert: HoldingAlert) => void) => () => void;
    onAlertStatus: (callback: (status: HoldingAlertStatus) => void) => () => void;
  };
}

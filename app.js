/**
 * app.js
 * نقطة الدخول الرئيسية: يربط بين مصدر البيانات (Binance/Bybit)، محرك القرار،
 * الرسم البياني، الواجهة، إدارة المخاطر، التنبيهات، والباك تست.
 */

import { CONFIG } from './config.js';
import { BinanceFeed } from './exchanges/binanceWS.js';
import { BybitFeed } from './exchanges/bybitWS.js';
import { DecisionEngine } from './engine/decisionEngine.js';
import { RiskManager } from './engine/riskManager.js';
import { Backtester } from './engine/backtester.js';
import { AlertsManager } from './ui/alerts.js';
import { ChartView } from './ui/chart.js';
import { UIController } from './ui/ui.js';
import { storage, throttle } from './utils/helpers.js';

class App {
    constructor() {
        this.exchange = storage.get('cfg_exchange', 'binance');
        this.symbol = storage.get('cfg_symbol', 'BTCUSDT');
        this.timeframe = storage.get('cfg_timeframe', CONFIG.defaultTimeframe);
        this.candles = [];
        this.feed = null;
        this.lastPrice = null;
        this.lastSignalKey = null; // لمنع تكرار نفس التنبيه لنفس الشمعة

        const alertSettings = storage.get('cfg_alerts', CONFIG.alerts);
        this.alerts = new AlertsManager(alertSettings);
        this.engine = new DecisionEngine(CONFIG.strategy);
        this.ui = new UIController();
        this.chart = new ChartView(document.getElementById('chartContainer'));

        this._bindStaticUI();
        this._applySettingsToInputs(alertSettings);
        this._renderSymbolList();
        this._startFeed();

        this.throttledAnalyze = throttle(() => this._runAnalysis(), 400);
    }

    // ==================== إعداد الواجهة الثابتة ====================
    _bindStaticUI() {
        // الفريمات الزمنية
        const tfGroup = document.getElementById('timeframeGroup');
        CONFIG.timeframes.forEach(tf => {
            const btn = document.createElement('button');
            btn.className = 'tf-btn' + (tf === this.timeframe ? ' active' : '');
            btn.textContent = tf;
            btn.addEventListener('click', () => this._changeTimeframe(tf));
            tfGroup.appendChild(btn);
        });

        // منصة التداول
        const exSelect = document.getElementById('exchangeSelect');
        exSelect.value = this.exchange;
        exSelect.addEventListener('change', () => this._changeExchange(exSelect.value));

        // البحث عن عملة
        const symbolInput = document.getElementById('symbolInput');
        let searchTimeout = null;
        symbolInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const q = symbolInput.value.trim();
            if (!q) { document.getElementById('symbolSuggestions').classList.add('hidden'); return; }
            searchTimeout = setTimeout(async () => {
                const FeedClass = this.exchange === 'binance' ? BinanceFeed : BybitFeed;
                const results = await FeedClass.searchSymbols(q);
                this.ui.renderSuggestions(results, (sym) => {
                    symbolInput.value = '';
                    this._changeSymbol(sym);
                });
            }, 350);
        });

        // إغلاق النوافذ المنبثقة
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            document.getElementById('settingsModal').classList.remove('hidden');
        });
        document.getElementById('backtestBtn').addEventListener('click', () => {
            document.getElementById('backtestModal').classList.remove('hidden');
        });

        document.getElementById('saveSettingsBtn').addEventListener('click', () => this._saveSettings());
        document.getElementById('runBacktestBtn').addEventListener('click', () => this._runBacktest());

        // إدارة المخاطر: إعادة الحساب عند تغيير المدخلات
        ['capitalInput', 'riskPercentInput', 'leverageInput'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this._recalculateRiskForCurrentSignal());
        });
    }

    _applySettingsToInputs(settings) {
        document.getElementById('soundToggle').checked = settings.soundEnabled;
        document.getElementById('telegramTokenInput').value = settings.telegramBotToken || '';
        document.getElementById('telegramChatIdInput').value = settings.telegramChatId || '';
        document.getElementById('discordWebhookInput').value = settings.discordWebhookUrl || '';
    }

    _saveSettings() {
        const settings = {
            soundEnabled: document.getElementById('soundToggle').checked,
            telegramBotToken: document.getElementById('telegramTokenInput').value.trim(),
            telegramChatId: document.getElementById('telegramChatIdInput').value.trim(),
            discordWebhookUrl: document.getElementById('discordWebhookInput').value.trim()
        };
        storage.set('cfg_alerts', settings);
        this.alerts.updateSettings(settings);
        document.getElementById('settingsModal').classList.add('hidden');
        this.ui.showToast('BUY', 'تم حفظ الإعدادات بنجاح ✅');
    }

    _renderSymbolList() {
        this.ui.renderSymbolList(CONFIG.defaultSymbols, this.symbol, (sym) => this._changeSymbol(sym));
        this.ui.setActiveSymbol(this.symbol);
    }

    // ==================== إدارة مصدر البيانات ====================
    async _startFeed() {
        this.ui.setConnectionStatus('connecting', '…جارٍ الاتصال');
        const FeedClass = this.exchange === 'binance' ? BinanceFeed : BybitFeed;
        this.feed = new FeedClass(this.symbol, this.timeframe, (candle, isClosed) => this._onCandle(candle, isClosed));

        try {
            this.candles = await this.feed.fetchHistory(CONFIG.historyCandleLimit);
            this.chart.setCandles(this.candles);
            this.chart.fitContent();
            this.feed.connect();
            this.ui.setConnectionStatus('connected', `متصل — ${CONFIG.exchanges[this.exchange].label}`);
            this._runAnalysis();
        } catch (err) {
            console.error(err);
            this.ui.setConnectionStatus('error', 'خطأ في الاتصال');
        }
    }

    _onCandle(candle, isClosed) {
        this.chart.updateLastCandle(candle);
        this.ui.updateLivePrice(candle.close, this.lastPrice);
        this.lastPrice = candle.close;

        const last = this.candles[this.candles.length - 1];
        if (last && last.time === candle.time) {
            this.candles[this.candles.length - 1] = candle;
        } else {
            this.candles.push(candle);
            if (this.candles.length > CONFIG.historyCandleLimit + 50) this.candles.shift();
        }

        // نحلل عند كل تحديث (مُقيَّد بـ throttle)، لكن الإشارة النهائية تُبنى فقط على شموع مغلقة
        this.throttledAnalyze();
    }

    // ==================== التحليل وإصدار الإشارات ====================
    _runAnalysis() {
        // نستخدم الشموع المغلقة فقط لتحليل الإشارة (No Repaint)، مع إضافة السعر الحي كمرجع للعرض
        const closedCandles = this.candles.filter(c => c.isClosed);
        if (closedCandles.length < 60) return;

        const analysis = this.engine.analyze(closedCandles);
        if (!analysis.ready) return;

        this.ui.updateAnalysis(analysis);
        this._drawZonesOnChart(analysis);

        if (analysis.signal) {
            const risk = this._calculateRisk(analysis.signal);
            this.ui.updateSignalRisk(risk);

            const signalKey = `${analysis.signal.direction}-${analysis.signal.time}-${closedCandles[closedCandles.length - 1].time}`;
            if (this.lastSignalKey !== signalKey) {
                this.lastSignalKey = signalKey;
                this.ui.showToast(analysis.signal.direction, `إشارة ${analysis.signal.direction} على ${this.symbol} بثقة ${analysis.signal.confidence}%`);
                this.alerts.fireSignalAlert(this.symbol, analysis.signal);
            }
        }
    }

    _calculateRisk(signal) {
        const capital = parseFloat(document.getElementById('capitalInput').value) || CONFIG.risk.defaultCapital;
        const riskPercent = parseFloat(document.getElementById('riskPercentInput').value) || CONFIG.risk.defaultRiskPercent;
        const leverage = parseFloat(document.getElementById('leverageInput').value) || CONFIG.risk.defaultLeverage;
        const rm = new RiskManager({ capital, riskPercent, leverage });
        return rm.calculate(signal.entry, signal.stopLoss);
    }

    _recalculateRiskForCurrentSignal() {
        const closedCandles = this.candles.filter(c => c.isClosed);
        if (closedCandles.length < 60) return;
        const analysis = this.engine.analyze(closedCandles);
        if (analysis.signal) {
            this.ui.updateSignalRisk(this._calculateRisk(analysis.signal));
        }
    }

    _drawZonesOnChart(analysis) {
        const lines = [
            { price: analysis.volumeProfile.poc, color: '#f59e0b', title: 'POC' },
            { price: analysis.volumeProfile.vah, color: '#8b5cf6', title: 'VAH' },
            { price: analysis.volumeProfile.val, color: '#8b5cf6', title: 'VAL' }
        ];
        if (analysis.signal) {
            const s = analysis.signal;
            lines.push(
                { price: s.entry, color: '#3b82f6', title: 'دخول', lineWidth: 2 },
                { price: s.stopLoss, color: '#ef4444', title: 'SL', lineWidth: 2 },
                { price: s.takeProfit1, color: '#22c55e', title: 'TP1' },
                { price: s.takeProfit2, color: '#22c55e', title: 'TP2' },
                { price: s.takeProfit3, color: '#22c55e', title: 'TP3' }
            );
        }
        this.chart.setPriceLines(lines);
    }

    // ==================== تبديل الرمز/الفريم/المنصة ====================
    async _changeSymbol(symbol) {
        this.symbol = symbol;
        storage.set('cfg_symbol', symbol);
        this.ui.setActiveSymbol(symbol);
        this._renderSymbolList();
        if (this.feed) this.feed.disconnect();
        await this._startFeed();
    }

    async _changeTimeframe(tf) {
        this.timeframe = tf;
        storage.set('cfg_timeframe', tf);
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.textContent === tf));
        if (this.feed) this.feed.disconnect();
        await this._startFeed();
    }

    async _changeExchange(ex) {
        this.exchange = ex;
        storage.set('cfg_exchange', ex);
        if (this.feed) this.feed.disconnect();
        await this._startFeed();
    }

    // ==================== الباك تست ====================
    async _runBacktest() {
        document.getElementById('backtestResults').classList.add('hidden');
        document.getElementById('backtestLoading').classList.remove('hidden');

        // نسمح للواجهة بالتحديث قبل بدء عملية حسابية قد تستغرق وقتًا
        await new Promise(r => setTimeout(r, 50));

        const closedCandles = this.candles.filter(c => c.isClosed);
        const backtester = new Backtester(closedCandles, CONFIG.strategy);
        const stats = backtester.run();
        this.ui.renderBacktestResults(stats);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.__app = new App();
});

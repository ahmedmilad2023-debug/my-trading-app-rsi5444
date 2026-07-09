/**
 * config.js
 * الإعدادات العامة للمشروع. لا توجد مفاتيح API حقيقية هنا.
 *
 * ملاحظة هامة حول مفاتيح API:
 * - بيانات الأسعار اللحظية (WebSocket العام) من Binance وBybit لا تحتاج API Key إطلاقًا،
 *   وهي كافية بالكامل لعمل هذا التطبيق (تحليل + إشارات + رسم بياني).
 * - مفاتيح API الخاصة بك (Private Key/Secret) تُستخدم فقط إذا رغبت مستقبلاً بتنفيذ صفقات
 *   حقيقية تلقائيًا عبر REST الموقّع (Signed Endpoints)، وهذا **غير ممكن تنفيذه بأمان من
 *   المتصفح مباشرة على GitHub Pages** لأن أي مفتاح سرّي يوضع في كود Frontend يصبح مكشوفًا
 *   لأي زائر للصفحة. لذلك هذا المشروع لا ينفذ صفقات حقيقية، ويكتفي بإصدار إشارات + تنبيهات،
 *   وهذا هو البديل الأصح والأكثر أمانًا من جهة المتصفح فقط.
 * - إن أردت لاحقًا التنفيذ التلقائي، ستحتاج خادمًا وسيطًا (Backend/Proxy) يحفظ المفتاح
 *   بأمان وينفذ الأوامر نيابة عنك؛ وهذا خارج نطاق GitHub Pages (استضافة ساكنة فقط).
 */

export const CONFIG = {
    // نقاط اتصال WebSocket العامة (لا تحتاج مفاتيح)
    exchanges: {
        binance: {
            wsBase: 'wss://fstream.binance.com/stream',
            restBase: 'https://fapi.binance.com',
            label: 'Binance Futures'
        },
        bybit: {
            wsBase: 'wss://stream.bybit.com/v5/public/linear',
            restBase: 'https://api.bybit.com',
            label: 'Bybit Futures'
        }
    },

    // الفريمات الزمنية المتاحة في الواجهة
    timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
    defaultTimeframe: '15m',

    // قائمة العملات الافتراضية (يمكن البحث عن غيرها من الواجهة)
    defaultSymbols: [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
        'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'
    ],

    // عدد الشموع التي تُحمَّل تاريخيًا عند بدء التشغيل
    historyCandleLimit: 500,

    // إعدادات محرك القرار (SMC Decision Engine)
    strategy: {
        adxThreshold: 25,          // الحد الأدنى لقوة الاتجاه
        atrPeriod: 14,
        adxPeriod: 14,
        swingLookback: 10,          // عدد الشموع للبحث عن القمم/القيعان (Liquidity)
        orderBlockLookback: 30,     // نطاق البحث عن Order Blocks
        volumeProfileBins: 24,      // عدد مستويات السعر لـ Volume Profile
        cvdLookback: 50,
        riskRewardTargets: [1.5, 2.5, 4],  // مضاعفات ATR لـ TP1 / TP2 / TP3
        stopLossAtrMultiplier: 1.2
    },

    // إدارة المخاطر الافتراضية
    risk: {
        defaultCapital: 1000,     // دولار
        defaultRiskPercent: 1,    // %
        defaultLeverage: 10
    },

    // التنبيهات
    alerts: {
        soundEnabled: true,
        telegramBotToken: '',   // ضع التوكن هنا من BotFather (اختياري) — انظر README
        telegramChatId: '',     // معرف المحادثة/القناة — انظر README
        discordWebhookUrl: ''   // رابط Discord Webhook — انظر README
    }
};

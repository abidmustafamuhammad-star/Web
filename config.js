'use strict';

// ============================================================
// NOKOS OTP - Configuration File
// Semua konfigurasi disimpan disini. JANGAN gunakan .env
// ============================================================

module.exports = {

  // ── Server ────────────────────────────────────────────── 
  server: {
    port: 3000,
    baseUrl: 'http://private.pterokudesu.web.id:5016',
    sessionSecret: 'Jee#sSdg$hssux@73&2#eycyzr?sgv$fxgxaocfyez38',
    cookieMaxAge: 7 * 24 * 60 * 60 * 1000,  // 7 hari (remember me)
    cookieMaxAgeShort: 24 * 60 * 60 * 1000, // 1 hari (session biasa)
    secureCookie: false, // Set true di produksi dengan HTTPS
    corsOrigins: ['http://private.pterokudesu.web.id:5016', 'http://localhost:3000'],
  },

  // ── Supabase ─────────────────────────────────────────────
  supabase: {
    url: 'https://iipotuxwrdgwjldqhjnx.supabase.co',
    serviceKey: 'sb_secret_I75ye9tZS9LzxZuVBDBQyw_AMR74H8t',
  },

  // ── RumahOTP (Server 1) ───────────────────────────────────
  rumahotp: {
    apiKey: 'rk-dev-RdViv8w8YSOqgzgusVz5f0XsISUpPRU0',
    baseUrl: 'https://www.rumahotp.io/api',
  },

  // ── SMSCode.gg (Server 2) ────────────────────────────────
  smscode: {
    apiToken: 'be5b5f50f6fd6f19aed95353b5466f5dad99603b1391cf16c1cccde592f40542',
    baseUrl: 'https://api.smscode.gg/v1',
  },

  // ── Pakasir Payment Gateway ───────────────────────────────
  pakasir: {
    slug: 'nokos2',
    apiKey: 'l6Sdy7xft6JKS3q73IlUBtbtxEY5qnfN',
    baseUrl: 'https://app.pakasir.com',
    defaultMethod: 'qris',
    webhookSecret: 'https://jeeyhosting.my.id/api/webhook',
  },

  // ── Keamanan ──────────────────────────────────────────────
  security: {
    bcryptRounds: 12,
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000,
    sessionTokenLength: 64,
    minPasswordLength: 8,
    rateLimitWindow: 60 * 1000,
    rateLimitMax: 100,
    webhookRateLimit: 5,
  },

  // ── Aplikasi & Branding ────────────────────────────────────
  app: {
    appName: 'Jeeyhosting',
    tagline: 'Platform OTP Instan, Aman & Terpercaya',
    currency: 'IDR',
    minDeposit: 5000,
    maxDeposit: 10_000_000,
    depositOptions: [5000, 10000, 15000, 20000],
    otpPollInterval: 5000,
    otpMaxPollDuration: 20 * 60 * 1000,

    // ── Branding / Icon ──────────────────────────────────────
    faviconUrl: 'https://cdn.shirokode.web.id/files/ZZIcYlXRZ4.jpeg',
    logoUrl: 'https://cdn.shirokode.web.id/files/ZZIcYlXRZ4.jpeg',
    logoIconUrl: 'https://cdn.shirokode.web.id/files/ZZIcYlXRZ4.jpeg',

    // ── Kontak & Link Sosial ──────────────────────────────────
    supportEmail: 'jeeyhosting@gmail.com',
    telegramSupport: 'https://t.me/Jeeyhosting',
    whatsappSupport: '6283122028438',
    instagramUrl: 'bangjeey_dev',
    twitterUrl: 'bangjeey_dev',

    // ── Landing Page ─────────────────────────────────────────
    heroTitle: 'OTP Instan,\nAman & Terpercaya',
    heroSubtitle: 'Dapatkan nomor OTP virtual dari seluruh dunia dengan 2 provider terbaik. Cepat, murah, dan terjamin keamanannya.',
    landingFeatures: [
      { icon: 'zap',     title: 'Proses Kilat',   desc: 'Nomor OTP tersedia dalam hitungan detik dari ribuan layanan.' },
      { icon: 'shield',  title: 'Aman & Terjamin', desc: 'Keamanan transaksi berlapis dengan sistem anti-fraud canggih.' },
      { icon: 'globe',   title: 'Jangkauan Global','desc': 'Dukungan ratusan negara & operator dari 2 server premium.' },
      { icon: 'wallet',  title: 'Harga Terjangkau','desc': 'Harga kompetitif mulai Rp500 tanpa biaya tersembunyi.' },
    ],
  },
};

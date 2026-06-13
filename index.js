'use strict';

// ============================================================
// NOKOS OTP — Main Server (index.js)
// Install: npm install express @supabase/supabase-js bcrypt axios cookie-parser cors
// Start  : node index.js
// ============================================================

const express    = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt     = require('bcrypt');
const crypto     = require('crypto');
const axios      = require('axios');
const cookieParser = require('cookie-parser');
const path       = require('path');
const cors       = require('cors');
const config     = require('./config');
console.log('CONFIG PORT =', config.server.port);
console.log('CONFIG FILE =', require.resolve('./config'));

// ── App & DB Init ────────────────────────────────────────────
const app = express();
const db  = createClient(config.supabase.url, config.supabase.serviceKey);

// ── In-Memory State ──────────────────────────────────────────
const loginAttemptStore  = new Map(); // ip → { count, until }
const requestCountStore  = new Map(); // ip → { count, resetAt }
const orderLockStore     = new Set(); // userId — prevent double-click
const webhookLockStore   = new Set(); // "source:orderId" — prevent replay

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// CORS
app.use(cors({
  origin: config.server.corsOrigins,
  credentials: true,
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=()');
  next();
});

// Rate limiter
const rateLimiter = (req, res, next) => {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = requestCountStore.get(ip);
  if (!rec || now > rec.resetAt) {
    requestCountStore.set(ip, { count: 1, resetAt: now + config.security.rateLimitWindow });
    return next();
  }
  if (rec.count >= config.security.rateLimitMax) {
    return res.status(429).json({ success: false, error: 'Terlalu banyak request. Coba lagi sebentar.' });
  }
  rec.count++;
  next();
};
app.use('/api/', rateLimiter);

// ============================================================
// HELPERS
// ============================================================
const genToken = () => crypto.randomBytes(config.security.sessionTokenLength).toString('hex');
const sanitize = (str) => (typeof str === 'string' ? str.replace(/[<>"'`]/g, '') : '');
const formatRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const getIp    = (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';

const log = {
  info : (...a) => console.log (`[${new Date().toISOString()}] INFO `, ...a),
  warn : (...a) => console.warn (`[${new Date().toISOString()}] WARN `, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a),
};

async function auditLog(userId, action, details, ip, status = 'success') {
  try {
    await db.from('audit_logs').insert({ user_id: userId || null, action, details, ip_address: ip, status });
  } catch (e) {
    log.error('AuditLog failed:', e.message);
  }
}

// ── Auth Middleware ──────────────────────────────────────────
async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies?.session || req.headers['x-session-token'];
    if (!token) return res.status(401).json({ success: false, error: 'Sesi tidak ditemukan. Silakan login.' });

    const { data: session, error } = await db
      .from('sessions')
      .select('*, users(id, username, email, balance, status, total_deposit, total_order, total_refund, total_tx, created_at)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !session) return res.status(401).json({ success: false, error: 'Sesi tidak valid atau sudah berakhir.' });
    if (session.users?.status !== 'active') return res.status(403).json({ success: false, error: 'Akun ditangguhkan.' });

    req.user    = session.users;
    req.session = session;
    next();
  } catch (e) {
    log.error('AuthMiddleware:', e.message);
    res.status(500).json({ success: false, error: 'Kesalahan server.' });
  }
}

// ── Supabase RPC Wrappers ─────────────────────────────────────
async function deductBalance(userId, amount, referenceId, description) {
  const { data, error } = await db.rpc('deduct_balance', {
    p_user_id: userId, p_amount: amount, p_reference_id: referenceId, p_description: description,
  });
  if (error) throw new Error('DB error: ' + error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) throw new Error(result?.error || 'Gagal memotong saldo');
  return result;
}

async function creditBalance(userId, amount, type, referenceId, description) {
  const { data, error } = await db.rpc('credit_balance', {
    p_user_id: userId, p_amount: amount, p_type: type, p_reference_id: referenceId, p_description: description,
  });
  if (error) throw new Error('DB error: ' + error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) throw new Error(result?.error || 'Gagal menambah saldo');
  return result;
}

// ── Provider API Wrappers ─────────────────────────────────────
async function rumahOtp(endpoint, params = {}) {
  const url = new URL(`${config.rumahotp.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await axios.get(url.toString(), {
    headers: { 'x-apikey': config.rumahotp.apiKey, accept: 'application/json' },
    timeout: 12000,
  });
  return res.data;
}

async function smsCode(method, endpoint, body = null, extraHeaders = {}) {
  const opts = {
    method: method.toUpperCase(),
    url: `${config.smscode.baseUrl}${endpoint}`,
    headers: { Authorization: `Bearer ${config.smscode.apiToken}`, 'Content-Type': 'application/json', ...extraHeaders },
    timeout: 12000,
  };
  if (body) opts.data = body;
  const res = await axios(opts);
  return res.data;
}

async function pakasirApi(endpoint, body) {
  const res = await axios.post(`${config.pakasir.baseUrl}${endpoint}`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return res.data;
}

async function pakasirTxDetail(orderId, amount) {
  const res = await axios.get(`${config.pakasir.baseUrl}/api/transactiondetail`, {
    params: { project: config.pakasir.slug, order_id: orderId, amount, api_key: config.pakasir.apiKey },
    timeout: 10000,
  });
  return res.data;
}

// ============================================================
// STATIC FILES
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'), { 
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});

// ============================================================
// AUTH ROUTES
// ============================================================

// Register
app.post('/api/auth/register', async (req, res) => {
  const ip = getIp(req);
  try {
    let { username, email, password } = req.body;
    username = sanitize(String(username || '')).trim().toLowerCase();
    email    = sanitize(String(email    || '')).trim().toLowerCase();
    password = String(password || '');

    if (!username || !email || !password)
      return res.status(400).json({ success: false, error: 'Semua field wajib diisi.' });
    if (username.length < 3 || username.length > 50)
      return res.status(400).json({ success: false, error: 'Username harus 3–50 karakter.' });
    if (!/^[a-z0-9_]+$/.test(username))
      return res.status(400).json({ success: false, error: 'Username hanya boleh huruf, angka, dan underscore.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, error: 'Format email tidak valid.' });
    if (password.length < config.security.minPasswordLength)
      return res.status(400).json({ success: false, error: `Password minimal ${config.security.minPasswordLength} karakter.` });

    // Check duplicate
    const { data: existing } = await db.from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`)
      .maybeSingle();
    if (existing) return res.status(409).json({ success: false, error: 'Username atau email sudah terdaftar.' });

    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
    const { data: user, error } = await db.from('users')
      .insert({ username, email, password_hash: passwordHash, balance: 0 })
      .select('id, username, email')
      .single();
    if (error) throw error;

    await auditLog(user.id, 'register', { username, email }, ip);
    log.info(`Register: ${username} (${email})`);
    res.json({ success: true, message: 'Registrasi berhasil! Silakan login.' });
  } catch (e) {
    log.error('Register:', e.message);
    await auditLog(null, 'register_error', { error: e.message }, ip, 'error');
    res.status(500).json({ success: false, error: 'Gagal mendaftar. Coba lagi.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const ip = getIp(req);
  try {
    // Brute-force check
    const attemptKey = ip;
    const attempt    = loginAttemptStore.get(attemptKey);
    if (attempt?.until && Date.now() < attempt.until) {
      const waitMin = Math.ceil((attempt.until - Date.now()) / 60000);
      return res.status(429).json({ success: false, error: `Terlalu banyak percobaan. Coba lagi dalam ${waitMin} menit.` });
    }

    let { login, password, remember } = req.body;
    login    = sanitize(String(login    || '')).trim().toLowerCase();
    password = String(password || '');
    remember = Boolean(remember);

    if (!login || !password)
      return res.status(400).json({ success: false, error: 'Username/email dan password wajib diisi.' });

    const isEmail = login.includes('@');
    const { data: user } = await db.from('users')
      .select('*')
      .eq(isEmail ? 'email' : 'username', login)
      .maybeSingle();

    const valid = user && await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      // Increment attempt counter
      const cur = loginAttemptStore.get(attemptKey) || { count: 0, until: null };
      cur.count++;
      if (cur.count >= config.security.maxLoginAttempts) {
        cur.until = Date.now() + config.security.lockoutDuration;
        loginAttemptStore.set(attemptKey, cur);
      } else {
        loginAttemptStore.set(attemptKey, cur);
      }
      await auditLog(user?.id, 'login_failed', { login }, ip, 'failed');
      return res.status(401).json({ success: false, error: 'Username/email atau password salah.' });
    }

    if (user.status !== 'active')
      return res.status(403).json({ success: false, error: 'Akun ditangguhkan. Hubungi admin.' });

    // Reset attempts
    loginAttemptStore.delete(attemptKey);

    // Create session
    const token     = genToken();
    const expiresAt = new Date(Date.now() + (remember ? config.server.cookieMaxAge : config.server.cookieMaxAgeShort));
    await db.from('sessions').insert({
      user_id: user.id, token, expires_at: expiresAt.toISOString(),
      ip_address: ip, user_agent: req.headers['user-agent'] || '',
    });

    res.cookie('session', token, {
      httpOnly: true,
      secure: config.server.secureCookie,
      sameSite: 'strict',
      maxAge: remember ? config.server.cookieMaxAge : config.server.cookieMaxAgeShort,
    });

    await auditLog(user.id, 'login', { login, remember }, ip);
    log.info(`Login: ${user.username}`);
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (e) {
    log.error('Login:', e.message);
    res.status(500).json({ success: false, error: 'Gagal login. Coba lagi.' });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.session || req.headers['x-session-token'];
    if (token) {
      await db.from('sessions').delete().eq('token', token);
    }
    res.clearCookie('session');
    res.json({ success: true });
  } catch (e) {
    res.json({ success: true }); // Logout always succeeds
  }
});

// Check session
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    user: {
      id: u.id, username: u.username, email: u.email,
      balance: u.balance, total_deposit: u.total_deposit,
      total_order: u.total_order, total_refund: u.total_refund,
      total_tx: u.total_tx, created_at: u.created_at, status: u.status,
    },
  });
});

// ============================================================
// DASHBOARD
// ============================================================
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const u = req.user;
    const { data: recentOrders } = await db.from('otp_orders')
      .select('id, service_name, country, price, status, otp_code, created_at')
      .eq('user_id', u.id).order('created_at', { ascending: false }).limit(5);
    const { data: recentDeposits } = await db.from('deposits')
      .select('invoice, amount, status, created_at')
      .eq('user_id', u.id).order('created_at', { ascending: false }).limit(5);

    res.json({
      success: true,
      stats: {
        balance: u.balance, total_deposit: u.total_deposit,
        total_order: u.total_order, total_refund: u.total_refund,
        total_tx: u.total_tx, joined: u.created_at, status: u.status,
      },
      recent_orders: recentOrders || [],
      recent_deposits: recentDeposits || [],
    });
  } catch (e) {
    log.error('Dashboard:', e.message);
    res.status(500).json({ success: false, error: 'Gagal memuat dashboard.' });
  }
});

// ============================================================
// CATALOG — SERVER 1 (RumahOTP)
// ============================================================
app.get('/api/catalog/s1/services', authMiddleware, async (req, res) => {
  try {
    const data = await rumahOtp('/v2/services');
    res.json({ success: true, data: data?.data || [] });
  } catch (e) {
    log.error('S1 Services:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil daftar layanan.' });
  }
});

app.get('/api/catalog/s1/countries', authMiddleware, async (req, res) => {
  try {
    const { service } = req.query;
    const params = service ? { service } : {};
    const data = await rumahOtp('/v2/countries', params);
    res.json({ success: true, data: data?.data || [] });
  } catch (e) {
    log.error('S1 Countries:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil daftar negara.' });
  }
});

app.get('/api/catalog/s1/operators', authMiddleware, async (req, res) => {
  try {
    const { country, service } = req.query;
    if (!country || !service)
      return res.status(400).json({ success: false, error: 'Parameter country dan service wajib.' });
    const data = await rumahOtp('/v2/operators', { country, service });
    res.json({ success: true, data: data?.data || [] });
  } catch (e) {
    log.error('S1 Operators:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil daftar operator.' });
  }
});

// ============================================================
// CATALOG — SERVER 2 (SMSCode.gg)
// ============================================================
app.get('/api/catalog/s2/countries', authMiddleware, async (req, res) => {
  try {
    const data = await smsCode('GET', '/catalog/countries');
    res.json({ success: true, data: data?.data || [] });
  } catch (e) {
    log.error('S2 Countries:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil daftar negara.' });
  }
});

app.get('/api/catalog/s2/services', authMiddleware, async (req, res) => {
  try {
    const { country_id } = req.query;
    const endpoint = country_id ? `/catalog/services?country_id=${country_id}` : '/catalog/services';
    const data = await smsCode('GET', endpoint);
    res.json({ success: true, data: data?.data || [] });
  } catch (e) {
    log.error('S2 Services:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil daftar layanan.' });
  }
});

app.get('/api/catalog/s2/products', authMiddleware, async (req, res) => {
  try {
    const { country_id, platform_id } = req.query;
    const params = new URLSearchParams({ limit: '100', sort: 'price_asc' });
    if (country_id)  params.set('country_id', country_id);
    if (platform_id) params.set('platform_id', platform_id);
    const data = await smsCode('GET', `/catalog/products?${params}`);
    res.json({ success: true, data: data?.data || [], meta: data?.meta || {} });
  } catch (e) {
    log.error('S2 Products:', e.message);
    res.status(502).json({ success: false, error: 'Gagal mengambil katalog produk.' });
  }
});

// ============================================================
// ORDER OTP
// ============================================================
app.post('/api/order/create', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const ip     = getIp(req);

  // Prevent double-click / double order
  if (orderLockStore.has(userId)) {
    return res.status(409).json({ success: false, error: 'Pesanan sedang diproses. Tunggu sebentar.' });
  }
  orderLockStore.add(userId);

  try {
    const { server, product_id, service_name, country, operator, price } = req.body;

    if (!server || !product_id || !service_name || !price)
      return res.status(400).json({ success: false, error: 'Data order tidak lengkap.' });
    if (!['rumahotp', 'smscode'].includes(server))
      return res.status(400).json({ success: false, error: 'Server tidak valid.' });

    const amount = parseInt(price);
    if (isNaN(amount) || amount <= 0)
      return res.status(400).json({ success: false, error: 'Harga tidak valid.' });

    // Check balance first (quick check, RPC will do the atomic check)
    if (req.user.balance < amount)
      return res.status(400).json({ success: false, error: `Saldo tidak cukup. Saldo: ${formatRp(req.user.balance)}, Harga: ${formatRp(amount)}` });

    // Generate idempotency key
    const idempotencyKey = `${userId}-${server}-${product_id}-${Date.now()}`;

    // Create order on provider
    let providerOrderId, phoneNumber, expiresAt;

    if (server === 'rumahotp') {
      if (!country || !operator)
        return res.status(400).json({ success: false, error: 'Negara dan operator wajib untuk Server 1.' });
      const result = await rumahOtp('/v2/orders', { service: product_id, country, operator });
      if (!result?.success) throw new Error(result?.error?.message || 'Provider error');
      const od = result.data;
      providerOrderId = String(od.order_id || od.id);
      phoneNumber     = od.number || od.phone_number || od.nomor || '';
      expiresAt       = od.expires_at || new Date(Date.now() + 20 * 60000).toISOString();
    } else {
      // smscode
      const idmKey = crypto.randomUUID();
      const result = await smsCode('POST', '/orders/create',
        { product_id: parseInt(product_id), quantity: 1 },
        { 'Idempotency-Key': idmKey });
      if (!result?.success) throw new Error(result?.error?.message || 'Provider error');
      const od = result.data?.orders?.[0];
      if (!od) throw new Error('Tidak ada nomor tersedia.');
      providerOrderId = String(od.id);
      phoneNumber     = od.phone_number || '';
      expiresAt       = od.expires_at;
    }

    // Create local order record first (before balance deduction)
    const { data: order, error: orderError } = await db.from('otp_orders').insert({
      user_id: userId, server, provider_order_id: providerOrderId,
      service_name: sanitize(service_name), country: sanitize(country || ''),
      operator: sanitize(operator || ''), phone_number: phoneNumber,
      price: amount, status: 'ACTIVE',
      expires_at: expiresAt, idempotency_key: idempotencyKey,
    }).select('id').single();
    if (orderError) throw new Error('Gagal menyimpan order: ' + orderError.message);

    // Atomic balance deduction
    const balResult = await deductBalance(userId, amount, order.id, `Order OTP: ${service_name}`);

    await auditLog(userId, 'order_create', { server, service_name, amount, order_id: order.id }, ip);
    log.info(`Order created: ${order.id} by ${req.user.username}`);

    res.json({
      success: true,
      order: {
        id: order.id, server, service_name, country, operator, phone_number: phoneNumber,
        price: amount, status: 'ACTIVE', expires_at: expiresAt,
        provider_order_id: providerOrderId,
      },
      new_balance: balResult.balance,
    });
  } catch (e) {
    log.error('Order Create:', e.message);
    await auditLog(userId, 'order_create_error', { error: e.message }, ip, 'error');
    res.status(500).json({ success: false, error: e.message || 'Gagal membuat pesanan.' });
  } finally {
    orderLockStore.delete(userId);
  }
});

// Check order status
app.get('/api/order/:orderId/status', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { data: order } = await db.from('otp_orders')
      .select('*').eq('id', orderId).eq('user_id', req.user.id).maybeSingle();
    if (!order) return res.status(404).json({ success: false, error: 'Order tidak ditemukan.' });

    // If still active, poll provider
    if (order.status === 'ACTIVE') {
      let providerStatus, otpCode = null, otpMsg = null;
      try {
        if (order.server === 'rumahotp') {
          const result = await rumahOtp('/v1/orders/get_status', { order_id: order.provider_order_id });
          if (result?.success) {
            const d = result.data;
            providerStatus = d.status;
            otpCode        = d.otp || d.code || d.sms || null;
          }
        } else {
          const result = await smsCode('GET', `/orders/${order.provider_order_id}`);
          if (result?.success) {
            const d = result.data;
            providerStatus = d.status;
            otpCode        = d.otp_code;
            otpMsg         = d.otp_message;
          }
        }

        // Map provider status to internal
        let newStatus = order.status;
        if (providerStatus) {
          const sMap = {
            'OTP_RECEIVED': 'OTP_RECEIVED', 'otp_received': 'OTP_RECEIVED',
            'COMPLETED': 'COMPLETED', 'completed': 'COMPLETED',
            'CANCELED': 'CANCELED',  'canceled': 'CANCELED',
            'EXPIRED': 'EXPIRED',    'expired': 'EXPIRED',
            'FAILED': 'FAILED',
          };
          newStatus = sMap[providerStatus] || order.status;
        }

        // Update if changed or OTP received
        if (newStatus !== order.status || (otpCode && !order.otp_code)) {
          const updates = { status: newStatus, updated_at: new Date().toISOString() };
          if (otpCode) { updates.otp_code = otpCode; updates.otp_received_at = new Date().toISOString(); }

          await db.from('otp_orders').update(updates).eq('id', orderId);

          // Auto-refund on EXPIRED/CANCELED if not yet refunded
          if (['EXPIRED', 'CANCELED'].includes(newStatus) && order.refund_status === 'none') {
            const { data: refRes } = await db.rpc('process_refund', { p_order_id: orderId, p_user_id: req.user.id });
            if (refRes?.success) {
              await auditLog(req.user.id, 'auto_refund', { order_id: orderId, amount: order.price }, getIp(req));
            }
          }

          Object.assign(order, updates, { otp_code: otpCode || order.otp_code });
        }
      } catch (provErr) {
        log.warn('Provider poll error:', provErr.message);
      }
    }

    res.json({ success: true, order });
  } catch (e) {
    log.error('Order Status:', e.message);
    res.status(500).json({ success: false, error: 'Gagal memeriksa status.' });
  }
});

// Cancel order
app.post('/api/order/cancel', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const ip     = getIp(req);
  try {
    const { order_id } = req.body;
    const { data: order } = await db.from('otp_orders')
      .select('*').eq('id', order_id).eq('user_id', userId).maybeSingle();
    if (!order) return res.status(404).json({ success: false, error: 'Order tidak ditemukan.' });
    if (order.status !== 'ACTIVE') return res.status(400).json({ success: false, error: 'Order tidak dapat dibatalkan.' });

    // Cancel on provider
    try {
      if (order.server === 'rumahotp') {
        await rumahOtp('/v1/orders/set_status', { order_id: order.provider_order_id, status: 'cancel' });
      } else {
        await smsCode('POST', '/orders/cancel', { id: parseInt(order.provider_order_id) });
      }
    } catch (e) {
      log.warn('Provider cancel error:', e.message);
    }

    // Update status
    await db.from('otp_orders').update({ status: 'CANCELED', updated_at: new Date().toISOString() }).eq('id', order_id);

    // Process refund
    const { data: refRes } = await db.rpc('process_refund', { p_order_id: order_id, p_user_id: userId });
    const refResult = Array.isArray(refRes) ? refRes[0] : refRes;

    await auditLog(userId, 'order_cancel', { order_id, refunded: refResult?.success }, ip);
    res.json({ success: true, refunded: refResult?.success, new_balance: refResult?.balance });
  } catch (e) {
    log.error('Order Cancel:', e.message);
    res.status(500).json({ success: false, error: 'Gagal membatalkan pesanan.' });
  }
});

// Finish order
app.post('/api/order/finish', authMiddleware, async (req, res) => {
  try {
    const { order_id } = req.body;
    const { data: order } = await db.from('otp_orders')
      .select('*').eq('id', order_id).eq('user_id', req.user.id).maybeSingle();
    if (!order) return res.status(404).json({ success: false, error: 'Order tidak ditemukan.' });

    try {
      if (order.server === 'smscode') {
        await smsCode('POST', '/orders/finish', { id: parseInt(order.provider_order_id) });
      } else {
        await rumahOtp('/v1/orders/set_status', { order_id: order.provider_order_id, status: 'finish' });
      }
    } catch (e) {
      log.warn('Provider finish error:', e.message);
    }

    await db.from('otp_orders').update({ status: 'COMPLETED', updated_at: new Date().toISOString() }).eq('id', order_id);
    res.json({ success: true });
  } catch (e) {
    log.error('Order Finish:', e.message);
    res.status(500).json({ success: false, error: 'Gagal menyelesaikan pesanan.' });
  }
});

// ============================================================
// HISTORY
// ============================================================
app.get('/api/history/orders', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = db.from('otp_orders').select('*', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    if (status) query = query.eq('status', status.toUpperCase());
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    log.error('History Orders:', e.message);
    res.status(500).json({ success: false, error: 'Gagal mengambil riwayat.' });
  }
});

app.get('/api/history/deposits', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { data, error, count } = await db.from('deposits')
      .select('*', { count: 'exact' }).eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    log.error('History Deposits:', e.message);
    res.status(500).json({ success: false, error: 'Gagal mengambil riwayat deposit.' });
  }
});

// ============================================================
// DEPOSIT
// ============================================================
app.post('/api/deposit/create', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const ip     = getIp(req);
  try {
    let { amount, payment_method } = req.body;
    amount = parseInt(amount);
    payment_method = payment_method || config.pakasir.defaultMethod;

    if (isNaN(amount) || amount < config.app.minDeposit)
      return res.status(400).json({ success: false, error: `Minimal deposit ${formatRp(config.app.minDeposit)}.` });
    if (amount > config.app.maxDeposit)
      return res.status(400).json({ success: false, error: `Maksimal deposit ${formatRp(config.app.maxDeposit)}.` });

    // Check pending deposits (max 3)
    const { count } = await db.from('deposits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'pending');
    if (count >= 3)
      return res.status(400).json({ success: false, error: 'Maksimal 3 deposit pending sekaligus.' });

    // Generate unique invoice
    const invoice = `INV${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Create deposit record
    const { data: deposit, error: depErr } = await db.from('deposits').insert({
      user_id: userId, invoice, amount, status: 'pending',
      payment_method, pakasir_order_id: invoice,
    }).select('id').single();
    if (depErr) throw depErr;

    // Create Pakasir transaction
    const redirectUrl = `${config.server.baseUrl}/api/deposit/callback?invoice=${invoice}`;
    let paymentData;

    if (payment_method === 'redirect') {
      // Use redirect URL for QRIS-only
      paymentData = {
        payment_url: `${config.pakasir.baseUrl}/pay/${config.pakasir.slug}/${amount}?order_id=${invoice}&redirect=${encodeURIComponent(redirectUrl)}&qris_only=1`,
        type: 'redirect',
      };
    } else {
      const pakResult = await pakasirApi(`/api/transactioncreate/${payment_method}`, {
        project: config.pakasir.slug, order_id: invoice, amount, api_key: config.pakasir.apiKey,
      });
      paymentData = {
        type: 'api',
        payment_number: pakResult.payment?.payment_number || '',
        total_payment:  pakResult.payment?.total_payment || amount,
        expired_at:     pakResult.payment?.expired_at || '',
        payment_method: pakResult.payment?.payment_method || payment_method,
        payment_url: `${config.pakasir.baseUrl}/pay/${config.pakasir.slug}/${amount}?order_id=${invoice}`,
      };
    }

    await auditLog(userId, 'deposit_create', { invoice, amount, payment_method }, ip);
    res.json({ success: true, invoice, amount, deposit_id: deposit.id, payment: paymentData });
  } catch (e) {
    log.error('Deposit Create:', e.message);
    await auditLog(userId, 'deposit_error', { error: e.message }, ip, 'error');
    res.status(500).json({ success: false, error: 'Gagal membuat deposit.' });
  }
});

// Check deposit status
app.get('/api/deposit/status/:invoice', authMiddleware, async (req, res) => {
  try {
    const { invoice } = req.params;
    const { data: deposit } = await db.from('deposits')
      .select('*').eq('invoice', invoice).eq('user_id', req.user.id).maybeSingle();
    if (!deposit) return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan.' });

    // If pending, cross-check with Pakasir
    if (deposit.status === 'pending') {
      try {
        const txDetail = await pakasirTxDetail(invoice, deposit.amount);
        if (txDetail?.transaction?.status === 'completed' && !deposit.webhook_received) {
          // Verify and credit (in case webhook missed)
          await processDeposit(invoice, deposit.amount, deposit.user_id, 'manual_check');
        }
      } catch (e) {
        log.warn('Deposit status check error:', e.message);
      }
    }

    const { data: updated } = await db.from('deposits').select('*').eq('invoice', invoice).maybeSingle();
    res.json({ success: true, deposit: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Gagal memeriksa status.' });
  }
});

// Cancel deposit
app.post('/api/deposit/cancel', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const { invoice } = req.body;
    const { data: deposit } = await db.from('deposits')
      .select('*').eq('invoice', invoice).eq('user_id', userId).maybeSingle();
    if (!deposit) return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan.' });
    if (deposit.status !== 'pending') return res.status(400).json({ success: false, error: 'Deposit tidak dapat dibatalkan.' });

    try {
      await pakasirApi('/api/transactioncancel', {
        project: config.pakasir.slug, order_id: invoice, amount: deposit.amount, api_key: config.pakasir.apiKey,
      });
    } catch (e) { log.warn('Pakasir cancel:', e.message); }

    await db.from('deposits').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('invoice', invoice);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Gagal membatalkan deposit.' });
  }
});

// ── Helper: Process Deposit ──────────────────────────────────
async function processDeposit(orderId, amount, userId, source) {
  // Idempotency guard
  const lockKey = `pakasir:${orderId}`;
  if (webhookLockStore.has(lockKey)) return { skip: true };
  webhookLockStore.add(lockKey);
  setTimeout(() => webhookLockStore.delete(lockKey), 30000);

  try {
    // Check if already processed
    const { data: dep } = await db.from('deposits')
      .select('id, status, user_id, amount')
      .eq('invoice', orderId).maybeSingle();

    if (!dep || dep.status === 'completed') return { skip: true };
    if (dep.amount !== amount) throw new Error('Amount mismatch');
    if (dep.user_id !== userId && userId) throw new Error('User mismatch');

    const finalUserId = dep.user_id;

    // Mark as completed atomically
    const { error: updateErr } = await db.from('deposits').update({
      status: 'completed', webhook_received: true,
      webhook_received_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('invoice', orderId).eq('status', 'pending');

    if (updateErr) throw updateErr;

    // Credit user balance
    await creditBalance(finalUserId, amount, 'deposit', dep.id, `Deposit #${orderId}`);
    await auditLog(finalUserId, 'deposit_completed', { invoice: orderId, amount, source }, null);
    log.info(`Deposit credited: ${orderId} amount=${amount}`);
    return { success: true };
  } finally {
    webhookLockStore.delete(lockKey);
  }
}

// ============================================================
// WEBHOOK — PAKASIR
// ============================================================
app.post('/api/webhook/pakasir', async (req, res) => {
  const ip = getIp(req);
  try {
    const body = req.body;
    log.info(`Webhook Pakasir received: ${JSON.stringify(body)}`);

    // Validate required fields
    const { amount, order_id, project, status } = body;
    if (!amount || !order_id || !project || !status)
      return res.status(400).json({ success: false, error: 'Invalid webhook payload' });

    // Validate project
    if (project !== config.pakasir.slug)
      return res.status(400).json({ success: false, error: 'Invalid project' });

    // Only process completed payments
    if (status !== 'completed') {
      return res.json({ success: true, message: 'Status not completed, skipped' });
    }

    // Log webhook (prevent replay)
    const { error: logErr } = await db.from('webhook_logs').insert({
      source: 'pakasir', order_id: String(order_id),
      payload: body, processed: false,
    });
    if (logErr?.code === '23505') { // Unique violation = already processed
      log.warn(`Duplicate webhook: pakasir:${order_id}`);
      return res.json({ success: true, message: 'Already processed' });
    }

    // Verify with Pakasir API (do not trust webhook alone)
    let verified = false;
    try {
      const txDetail = await pakasirTxDetail(order_id, amount);
      verified = txDetail?.transaction?.status === 'completed' &&
                 txDetail?.transaction?.amount == amount;
    } catch (e) {
      log.warn('Pakasir verify error:', e.message);
      // If can't verify, proceed with caution but still cross-check DB amount
    }

    // Find deposit by invoice
    const { data: deposit } = await db.from('deposits')
      .select('id, user_id, amount, status').eq('invoice', order_id).maybeSingle();

    if (!deposit) {
      await db.from('webhook_logs').update({ processed: false }).eq('order_id', String(order_id)).eq('source', 'pakasir');
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // Amount validation
    if (deposit.amount !== parseInt(amount)) {
      log.warn(`Amount mismatch: expected ${deposit.amount}, got ${amount}`);
      return res.status(400).json({ success: false, error: 'Amount mismatch' });
    }

    const result = await processDeposit(order_id, parseInt(amount), deposit.user_id, 'webhook');

    // Mark webhook as processed
    await db.from('webhook_logs').update({ processed: true }).eq('order_id', String(order_id)).eq('source', 'pakasir');

    await auditLog(deposit.user_id, 'webhook_pakasir', { order_id, amount, verified }, ip);
    res.json({ success: true });
  } catch (e) {
    log.error('Webhook Pakasir:', e.message);
    await auditLog(null, 'webhook_error', { error: e.message, body: req.body }, ip, 'error');
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ============================================================
// PROFILE
// ============================================================
app.get('/api/profile', authMiddleware, async (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    profile: {
      id: u.id, username: u.username, email: u.email, balance: u.balance,
      total_deposit: u.total_deposit, total_order: u.total_order,
      total_refund: u.total_refund, total_tx: u.total_tx,
      created_at: u.created_at, status: u.status,
    },
  });
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((req, res) => res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => {
  log.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Kesalahan server internal.' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(config.server.port, () => {
  log.info(`${config.app.appName} running on port ${config.server.port}`);
  log.info(`URL: ${config.server.baseUrl}`);
  log.info('Dependencies: npm install express @supabase/supabase-js bcrypt axios cookie-parser cors');
});

module.exports = app;

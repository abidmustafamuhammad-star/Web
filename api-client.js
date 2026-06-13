// ============================================================
// API CLIENT untuk Server 1 (RumahOTP) & Server 2 (SMSCode)
// Analisis & perbaikan dari code Telegram bot
// ============================================================

class APIClient {
  constructor(config) {
    this.config = config;
  }

  // =============================================
  // RETRY MECHANISM — hanya untuk GET requests
  // =============================================
  async requestWithRetry(requestFn, { maxRetries = 2, label = 'API' } = {}) {
    let lastErr;
    let attempt = 0;

    for (attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await requestFn();
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;

        // Client errors (4xx) selain 429 → jangan retry
        if (status && status >= 400 && status < 500 && status !== 429) {
          console.warn(`⚠️ [${label}] Client error ${status} - skip retry:`, err.message);
          throw err;
        }

        // Server errors (5xx) atau network errors → boleh retry
        if (attempt <= maxRetries) {
          const delay = 1000 * attempt; // Exponential: 1s, 2s, 3s
          console.log(`⏳ [${label}] attempt ${attempt} failed, retry dalam ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }

    console.error(`❌ [${label}] semua ${attempt - 1} attempts gagal`);
    throw lastErr;
  }

  // =============================================
  // SERVER 1: RumahOTP API Client
  // =============================================
  async apiRequest(endpoint, params = {}) {
    try {
      const headers = {
        'x-apikey': this.config.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      };

      let url;
      const timeouts = {
        services: 8000,
        countries: 10000,
        operators: 10000,
        order: 25000,
        status: 10000,
        cancel: 20000,
      };

      // === BUILD ENDPOINTS ===
      switch (endpoint) {
        case 'services':
          url = 'https://www.rumahotp.my.id/api/v2/services';
          break;

        case 'countries':
          // ✅ FIX: tidak perlu parameter, ambil semua
          url = 'https://www.rumahotp.my.id/api/v2/countries';
          break;

        case 'operators':
          // ✅ FIX: gunakan country & number_id, bukan provider_id
          if (!params.country || !params.number_id) {
            throw new Error('country & number_id required untuk operators endpoint');
          }
          url = `https://www.rumahotp.my.id/api/v2/operators?country=${encodeURIComponent(params.country)}&number_id=${params.number_id}`;
          break;

        case 'order':
          // ✅ FIX: hanya butuh number_id
          if (!params.number_id) {
            throw new Error('number_id required untuk order endpoint');
          }
          url = `https://www.rumahotp.my.id/api/v2/orders?number_id=${params.number_id}`;
          console.log(`🔗 [S1 Order] URL: ${url}`);
          break;

        case 'status':
          // ✅ Status check - gunakan v1 endpoint
          if (!params.order_id) {
            throw new Error('order_id required untuk status endpoint');
          }
          url = `https://www.rumahotp.my.id/api/v1/orders/get_status?order_id=${params.order_id}`;
          console.log(`🔗 [S1 Status] URL (v1): ${url}`);
          break;

        case 'cancel':
          // ✅ Cancel order
          if (!params.order_id) {
            throw new Error('order_id required untuk cancel endpoint');
          }
          url = `https://www.rumahotp.my.id/api/v1/orders/set_status?order_id=${params.order_id}&status=cancel`;
          break;

        default:
          throw new Error(`Unknown endpoint: ${endpoint}`);
      }

      // === RETRY LOGIC ===
      // CREATE requests (order) → NO RETRY (cegah duplicate)
      // READ requests (status, countries) → RETRY
      const isCreateOp = (endpoint === 'order' || endpoint === 'cancel');
      const timeout = timeouts[endpoint] || 12000;

      let response;
      if (isCreateOp) {
        // Direct call, no retry
        response = await axios.get(url, { headers, timeout });
      } else {
        // With retry untuk GET operations
        response = await this.requestWithRetry(
          () => axios.get(url, { headers, timeout }),
          { maxRetries: 2, label: `S1-${endpoint}` }
        );
      }

      const respData = response.data;
      console.log(`✅ [S1 ${endpoint}] success:`, JSON.stringify(respData).substring(0, 300));
      return respData;

    } catch (error) {
      // =============================================
      // IMPROVED ERROR HANDLING
      // =============================================
      const status = error.response?.status;
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;

      console.error(`❌ [S1 ${endpoint}] ${status || 'Network'} Error:`, errorMsg);

      return {
        success: false,
        error: {
          code: status || 'NETWORK_ERROR',
          message: errorMsg,
          endpoint: endpoint,
          timestamp: new Date().toISOString(),
          details: error.response?.data,
        },
      };
    }
  }

  // =============================================
  // SERVER 2: SMSCode.gg API Client
  // =============================================
  async apiRequestSmsCode(endpoint, method = 'GET', body = null, params = {}) {
    try {
      const token = this.config.SMSCODE_API_TOKEN;
      if (!token) {
        return {
          success: false,
          error: { code: 'NO_TOKEN', message: 'API Token belum dikonfigurasi' },
        };
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      let url = `${this.config.SMSCODE_BASE_URL}/${endpoint}`;
      if (method === 'GET' && Object.keys(params).length > 0) {
        url += '?' + new URLSearchParams(params).toString();
      }

      const timeouts = {
        'GET': 10000,
        'POST': 25000,
      };

      const timeout = timeouts[method] || 12000;
      const options = { headers, timeout };

      let response;
      if (method === 'GET') {
        // GET = READ → boleh retry
        response = await this.requestWithRetry(
          () => axios.get(url, options),
          { maxRetries: 2, label: `S2-${endpoint}` }
        );
      } else {
        // POST = CREATE → NO RETRY
        response = await axios.post(url, body, options);
      }

      console.log(`✅ [S2 ${endpoint}] success:`, JSON.stringify(response.data).substring(0, 200));
      return response.data;

    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;

      console.error(`❌ [S2 ${endpoint}] ${status || 'Network'} Error:`, errorMsg);

      return {
        success: false,
        error: {
          code: status || 'NETWORK_ERROR',
          message: errorMsg,
          endpoint: endpoint,
          timestamp: new Date().toISOString(),
          details: error.response?.data,
        },
      };
    }
  }

  // =============================================
  // UTILITY: Get Country Flag Emoji
  // =============================================
  getCountryFlag(country) {
    try {
      // Cek ISO code fields
      const codeRaw = (country && (
        country.iso2 || 
        country.iso || 
        country.iso_code || 
        country.country_iso || 
        country.country_code || 
        country.code || 
        country.country_short || 
        country.short_name
      )) || '';

      const codeCandidate = codeRaw.toString().toUpperCase().replace(/[^A-Z]/g, '');

      // Convert 2-letter code ke emoji flag
      if (codeCandidate.length === 2) {
        const codePoints = Array.from(codeCandidate).map(
          c => 127397 + c.charCodeAt(0)
        );
        return String.fromCodePoint(...codePoints);
      }

      // Fallback: hardcoded flags untuk negara populer
      const nameRaw = (country && (
        country.country_name || 
        country.country || 
        country.name
      )) || '';

      const name = nameRaw.toString().toLowerCase().trim();

      const flagByName = {
        // ASIA
        'indonesia': '🇮🇩',
        'malaysia': '🇲🇾',
        'singapore': '🇸🇬',
        'thailand': '🇹🇭',
        'vietnam': '🇻🇳',
        'philippines': '🇵🇭',
        'hong kong': '🇭🇰',
        'south korea': '🇰🇷',
        'japan': '🇯🇵',
        'china': '🇨🇳',
        'india': '🇮🇳',
        'pakistan': '🇵🇰',
        'bangladesh': '🇧🇩',
        
        // AMERICAS
        'united states': '🇺🇸',
        'canada': '🇨🇦',
        'brazil': '🇧🇷',
        'mexico': '🇲🇽',
        
        // EUROPE
        'united kingdom': '🇬🇧',
        'russia': '🇷🇺',
        'germany': '🇩🇪',
        'france': '🇫🇷',
        'italy': '🇮🇹',
        'spain': '🇪🇸',
        'netherlands': '🇳🇱',
        'poland': '🇵🇱',
        'ukraine': '🇺🇦',
      };

      return flagByName[name] || '🌍';
    } catch (err) {
      console.warn('Flag generation error:', err.message);
      return '🌍';
    }
  }

  // =============================================
  // DIAGNOSTIC: Test All Endpoints
  // =============================================
  async testAllEndpoints() {
    console.log('\n🧪 === TESTING ALL S1 ENDPOINTS ===\n');

    try {
      // 1. Services
      console.log('1️⃣  Testing Services...');
      const services = await this.apiRequest('services');
      console.log(`   ✅ Got ${services.data?.length || 0} services\n`);

      // 2. Countries
      console.log('2️⃣  Testing Countries...');
      const countries = await this.apiRequest('countries');
      console.log(`   ✅ Got ${countries.data?.length || 0} countries\n`);

      // 3. Operators (example)
      if (countries.data?.[0]) {
        const firstCountry = countries.data[0];
        console.log(`3️⃣  Testing Operators (${firstCountry.country_name})...`);
        const operators = await this.apiRequest('operators', {
          country: firstCountry.country_iso || firstCountry.iso2,
          number_id: firstCountry.number_id || '1', // Adjust if needed
        });
        console.log(`   ✅ Got ${operators.data?.length || 0} operators\n`);
      }

      console.log('✅ All endpoint tests completed!');
    } catch (err) {
      console.error('❌ Test failed:', err.message);
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APIClient;
}

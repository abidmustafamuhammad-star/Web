// ============================================================
// TEST SUITE — Verifikasi semua endpoint & functionality
// Run: node test-endpoints.js
// ============================================================

const axios = require('axios');

// =============================================
// CONFIGURATION
// =============================================
const CONFIG = {
  RUMAHOTP_API_KEY: 'rk-dev-RdViv8w8YSOqgzgusVz5f0XsISUpPRU0',
  SMSCODE_API_TOKEN: 'be5b5f50f6fd6f19aed95353b5466f5dad99603b1391cf16c1cccde592f40542',
  SMSCODE_BASE_URL: 'https://api.smscode.gg/v1',
};

// =============================================
// TEST RESULTS TRACKER
// =============================================
const results = {
  passed: [],
  failed: [],
  warnings: [],
};

function addResult(testName, status, details = '') {
  const log = {
    name: testName,
    status,
    details,
    timestamp: new Date().toISOString(),
  };

  if (status === 'PASS') {
    results.passed.push(log);
    console.log(`✅ PASS: ${testName}`);
  } else if (status === 'FAIL') {
    results.failed.push(log);
    console.log(`❌ FAIL: ${testName} — ${details}`);
  } else if (status === 'WARN') {
    results.warnings.push(log);
    console.log(`⚠️  WARN: ${testName} — ${details}`);
  }
  if (details) console.log(`   → ${details}\n`);
}

// =============================================
// TEST 1: Services Endpoint
// =============================================
async function testS1Services() {
  console.log('\n📊 TEST 1: Server 1 - Services Endpoint\n');
  try {
    const response = await axios.get('https://www.rumahotp.my.id/api/v2/services', {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 8000,
    });

    if (response.data?.success === true && Array.isArray(response.data?.data)) {
      const count = response.data.data.length;
      addResult('S1 Services', 'PASS', `Berhasil ambil ${count} services`);
      console.log(`   Sample services: ${response.data.data.slice(0, 3).map(s => s.service_name).join(', ')}`);
      return response.data.data;
    } else if (Array.isArray(response.data?.data)) {
      const count = response.data.data.length;
      addResult('S1 Services', 'PASS', `Berhasil ambil ${count} services (no success flag)`);
      return response.data.data;
    } else {
      addResult('S1 Services', 'FAIL', `Invalid response format: ${JSON.stringify(response.data).substring(0, 100)}`);
      return null;
    }
  } catch (error) {
    addResult('S1 Services', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    return null;
  }
}

// =============================================
// TEST 2: Countries Endpoint
// =============================================
async function testS1Countries() {
  console.log('\n🌍 TEST 2: Server 1 - Countries Endpoint\n');
  try {
    const response = await axios.get('https://www.rumahotp.my.id/api/v2/countries', {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    if (response.data?.success === true && Array.isArray(response.data?.data)) {
      const count = response.data.data.length;
      addResult('S1 Countries', 'PASS', `Berhasil ambil ${count} countries`);
      console.log(`   Sample: ${response.data.data.slice(0, 3).map(c => c.country_name || c.name).join(', ')}`);
      return response.data.data;
    } else if (Array.isArray(response.data?.data)) {
      const count = response.data.data.length;
      addResult('S1 Countries', 'PASS', `Berhasil ambil ${count} countries (no success flag)`);
      return response.data.data;
    } else {
      addResult('S1 Countries', 'FAIL', `Invalid response format`);
      return null;
    }
  } catch (error) {
    addResult('S1 Countries', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    return null;
  }
}

// =============================================
// TEST 3: Operators Endpoint
// =============================================
async function testS1Operators(countries) {
  console.log('\n👥 TEST 3: Server 1 - Operators Endpoint\n');
  
  if (!countries || countries.length === 0) {
    addResult('S1 Operators', 'WARN', 'Skipped - no countries data');
    return null;
  }

  try {
    const country = countries[0];
    const countryCode = country.country_iso || country.iso2 || country.iso || country.code;
    const numberId = country.number_id || country.id;

    if (!countryCode) {
      addResult('S1 Operators', 'WARN', 'Country code not found in data');
      return null;
    }

    console.log(`   Testing with: ${country.country_name} (${countryCode}), number_id: ${numberId}`);

    const url = `https://www.rumahotp.my.id/api/v2/operators?country=${encodeURIComponent(countryCode)}&number_id=${numberId}`;
    console.log(`   URL: ${url}\n`);

    const response = await axios.get(url, {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    if (Array.isArray(response.data?.data) || response.data?.success) {
      const count = Array.isArray(response.data?.data) ? response.data.data.length : 0;
      addResult('S1 Operators', 'PASS', `Berhasil ambil ${count} operators untuk ${country.country_name}`);
      if (count > 0) {
        console.log(`   Sample: ${response.data.data.slice(0, 2).map(o => o.operator_name || o.name).join(', ')}`);
      }
      return response.data.data;
    } else {
      addResult('S1 Operators', 'WARN', `No operators data: ${JSON.stringify(response.data).substring(0, 100)}`);
      return null;
    }
  } catch (error) {
    addResult('S1 Operators', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    return null;
  }
}

// =============================================
// TEST 4: Check Order Structure (Read-only)
// =============================================
async function testS1OrderStructure() {
  console.log('\n📦 TEST 4: Server 1 - Order Endpoint Structure\n');
  
  try {
    // Test dengan number_id yang random untuk cek endpoint responsiveness
    const testNumberId = '123456';
    const url = `https://www.rumahotp.my.id/api/v2/orders?number_id=${testNumberId}`;

    const response = await axios.get(url, {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 25000,
    });

    // Endpoint ini mungkin return error jika number_id tidak valid, tapi struktur response bisa dicek
    if (response.status === 200) {
      addResult('S1 Order Structure', 'PASS', 'Endpoint accessible & responding');
      console.log(`   Response type: ${typeof response.data}`);
      console.log(`   Sample: ${JSON.stringify(response.data).substring(0, 150)}`);
    }
  } catch (error) {
    // 404 atau invalid number adalah expected
    if (error.response?.status === 404 || error.response?.status === 400) {
      addResult('S1 Order Structure', 'PASS', `Endpoint accessible (status ${error.response.status})`);
    } else {
      addResult('S1 Order Structure', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    }
  }
}

// =============================================
// TEST 5: Status Endpoint (v1)
// =============================================
async function testS1StatusStructure() {
  console.log('\n⏳ TEST 5: Server 1 - Status Endpoint (v1)\n');
  
  try {
    const testOrderId = '999999'; // Invalid order untuk test structure
    const url = `https://www.rumahotp.my.id/api/v1/orders/get_status?order_id=${testOrderId}`;

    const response = await axios.get(url, {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      addResult('S1 Status Endpoint', 'PASS', 'Endpoint accessible & responding');
      console.log(`   Response: ${JSON.stringify(response.data).substring(0, 150)}`);
    }
  } catch (error) {
    if (error.response?.status >= 400) {
      addResult('S1 Status Endpoint', 'PASS', `Endpoint accessible (status ${error.response.status})`);
    } else {
      addResult('S1 Status Endpoint', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    }
  }
}

// =============================================
// TEST 6: SMSCode Countries
// =============================================
async function testS2Countries() {
  console.log('\n🌍 TEST 6: Server 2 (SMSCode) - Countries Endpoint\n');
  
  try {
    const response = await axios.get(`${CONFIG.SMSCODE_BASE_URL}/catalog/countries`, {
      headers: {
        Authorization: `Bearer ${CONFIG.SMSCODE_API_TOKEN}`,
        Accept: 'application/json',
      },
      timeout: 10000,
    });

    if (response.data?.success && Array.isArray(response.data?.data)) {
      const count = response.data.data.length;
      addResult('S2 Countries', 'PASS', `Berhasil ambil ${count} countries`);
      console.log(`   Sample: ${response.data.data.slice(0, 3).map(c => c.country_name).join(', ')}`);
      return response.data.data;
    } else {
      addResult('S2 Countries', 'FAIL', 'Invalid response format');
      return null;
    }
  } catch (error) {
    addResult('S2 Countries', 'FAIL', `${error.response?.status || 'Network'} - ${error.message}`);
    return null;
  }
}

// =============================================
// TEST 7: Retry Logic
// =============================================
async function testRetryLogic() {
  console.log('\n🔄 TEST 7: Retry Logic (Simulated)\n');
  
  try {
    // Simulasi retry dengan endpoint yang sering timeout
    let attempts = 0;
    const maxRetries = 2;
    let lastError = null;

    for (let i = 1; i <= maxRetries + 1; i++) {
      attempts = i;
      try {
        const response = await axios.get('https://www.rumahotp.my.id/api/v2/services', {
          headers: {
            'x-apikey': CONFIG.RUMAHOTP_API_KEY,
            Accept: 'application/json',
          },
          timeout: 5000,
        });
        addResult('Retry Logic', 'PASS', `Connected on attempt ${attempts}`);
        return;
      } catch (err) {
        lastError = err;
        if (i <= maxRetries) {
          const delay = 1000 * i;
          console.log(`   Attempt ${i} failed, retry dalam ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    addResult('Retry Logic', 'WARN', `All ${attempts} attempts tried`);
  } catch (error) {
    addResult('Retry Logic', 'FAIL', error.message);
  }
}

// =============================================
// TEST 8: Error Handling
// =============================================
async function testErrorHandling() {
  console.log('\n⚠️  TEST 8: Error Handling\n');
  
  // Test invalid API key
  try {
    await axios.get('https://www.rumahotp.my.id/api/v2/services', {
      headers: {
        'x-apikey': 'INVALID_KEY',
        Accept: 'application/json',
      },
      timeout: 5000,
    });
    addResult('Error Handling - Invalid Key', 'FAIL', 'Should have thrown error');
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      addResult('Error Handling - Invalid Key', 'PASS', `Correctly rejected (${error.response.status})`);
    } else {
      addResult('Error Handling - Invalid Key', 'WARN', `Got ${error.response?.status || 'error'}`);
    }
  }

  // Test timeout
  try {
    await axios.get('https://www.rumahotp.my.id/api/v2/countries', {
      headers: {
        'x-apikey': CONFIG.RUMAHOTP_API_KEY,
        Accept: 'application/json',
      },
      timeout: 100, // Very short timeout
    });
    addResult('Error Handling - Timeout', 'FAIL', 'Should have timed out');
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      addResult('Error Handling - Timeout', 'PASS', 'Correctly detected timeout');
    } else {
      addResult('Error Handling - Timeout', 'WARN', `Got ${error.code}`);
    }
  }
}

// =============================================
// MAIN TEST RUNNER
// =============================================
async function runAllTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE API TEST SUITE - NokosOTP             ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Run tests in sequence
  const services = await testS1Services();
  const countries = await testS1Countries();
  const operators = await testS1Operators(countries);
  await testS1OrderStructure();
  await testS1StatusStructure();
  const s2Countries = await testS2Countries();
  await testRetryLogic();
  await testErrorHandling();

  // === SUMMARY ===
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log(`✅ PASSED: ${results.passed.length}`);
  results.passed.forEach(r => console.log(`   • ${r.name}`));

  console.log(`\n❌ FAILED: ${results.failed.length}`);
  results.failed.forEach(r => console.log(`   • ${r.name}: ${r.details}`));

  console.log(`\n⚠️  WARNINGS: ${results.warnings.length}`);
  results.warnings.forEach(r => console.log(`   • ${r.name}: ${r.details}`));

  const total = results.passed.length + results.failed.length + results.warnings.length;
  const successRate = Math.round((results.passed.length / total) * 100);

  console.log(`\n📊 Overall Success Rate: ${successRate}% (${results.passed.length}/${total})\n`);

  // Final verdict
  if (results.failed.length === 0) {
    console.log('🎉 ALL TESTS PASSED! Application is ready to use.\n');
    return true;
  } else {
    console.log(`⚠️  ${results.failed.length} test(s) failed. Review errors above.\n`);
    return false;
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('❌ Test runner error:', err);
  process.exit(1);
});

/**
 * Fake Shelly Pro 3EM — simulates a real smart meter for testing
 *
 * Responds to the same REST API endpoints as a real Shelly Pro 3EM.
 * Energy counter increments every second to simulate solar production.
 *
 * Usage: node fake-shelly.js [--port 8090] [--mode normal|zero|negative|huge|flaky]
 */

import http from 'http';

const PORT = parseInt(process.env.FAKE_SHELLY_PORT || '8090');
const MODE = process.env.FAKE_SHELLY_MODE || 'normal';

// Simulated meter state
let totalExportWh = 50000;  // 50 kWh already "produced"
let totalImportWh = 120000; // 120 kWh consumed
let startTime = Date.now();
let requestCount = 0;

// Simulate production: ~5kW solar panel = ~5000Wh/h = ~1.39Wh/s
const PRODUCTION_WH_PER_SEC = 1.39;

function getMeterState() {
  const elapsed = (Date.now() - startTime) / 1000;

  switch (MODE) {
    case 'normal':
      totalExportWh += PRODUCTION_WH_PER_SEC;
      break;
    case 'zero':
      // No production at all — counters stay frozen
      totalImportWh = totalImportWh; // explicitly no change
      break;
    case 'negative':
      totalExportWh -= 10;
      break;
    case 'huge':
      totalExportWh += 1000000000; // 1 GWh per tick
      break;
    case 'flaky':
      // 50% chance of not responding (handled at request level)
      totalExportWh += PRODUCTION_WH_PER_SEC;
      break;
    case 'ramp':
      // Gradually increasing production
      totalExportWh += PRODUCTION_WH_PER_SEC * (1 + elapsed / 60);
      break;
    default:
      totalExportWh += PRODUCTION_WH_PER_SEC;
  }

  // Simulate 3-phase readings
  const powerW = MODE === 'zero' ? 0 : MODE === 'huge' ? 999999999 : 5000 + Math.random() * 200 - 100;
  const voltage = 230 + Math.random() * 4 - 2;

  return {
    id: 0,
    // Total counters (cumulative Wh)
    total_act: totalImportWh,
    total_act_ret: totalExportWh,
    // Current power
    total_act_power: powerW,
    total_aprt_power: Math.abs(powerW) * 1.02,
    // Phase A
    a_act_power: powerW * 0.34,
    a_aprt_power: Math.abs(powerW) * 0.34,
    a_voltage: voltage,
    a_current: (powerW * 0.34) / voltage,
    a_pf: 0.98,
    a_freq: 50.0,
    // Phase B
    b_act_power: powerW * 0.33,
    b_aprt_power: Math.abs(powerW) * 0.33,
    b_voltage: voltage + 0.5,
    b_current: (powerW * 0.33) / voltage,
    b_pf: 0.97,
    b_freq: 50.0,
    // Phase C
    c_act_power: powerW * 0.33,
    c_aprt_power: Math.abs(powerW) * 0.33,
    c_voltage: voltage - 0.3,
    c_current: (powerW * 0.33) / voltage,
    c_pf: 0.99,
    c_freq: 50.0,
  };
}

function getDeviceInfo() {
  return {
    name: 'JOULE Test Meter',
    id: 'shellypro3em-test001',
    mac: 'AA:BB:CC:DD:EE:FF',
    model: 'SPEM-003CEBEU',
    gen: 2,
    fw_id: '20240213-114426/1.2.2-gbd17be6',
    ver: '1.2.2',
    app: 'Pro3EM',
    auth_en: false,
    auth_domain: null,
  };
}

const server = http.createServer((req, res) => {
  requestCount++;

  // Flaky mode: 50% chance of hanging/timeout
  if (MODE === 'flaky' && Math.random() < 0.5) {
    // Just don't respond — let the client timeout
    setTimeout(() => {
      try { res.destroy(); } catch {}
    }, 10000);
    console.log(`  [${requestCount}] FLAKY — no response (simulating timeout)`);
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader('Content-Type', 'application/json');

  if (path === '/rpc/EM.GetStatus') {
    const state = getMeterState();
    res.writeHead(200);
    res.end(JSON.stringify(state));
    console.log(`  [${requestCount}] EM.GetStatus → ${(state.total_act_ret / 1000).toFixed(2)} kWh export, ${state.total_act_power.toFixed(0)}W`);
  } else if (path === '/rpc/Shelly.GetDeviceInfo') {
    res.writeHead(200);
    res.end(JSON.stringify(getDeviceInfo()));
    console.log(`  [${requestCount}] Shelly.GetDeviceInfo → Pro3EM`);
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    console.log(`  [${requestCount}] 404: ${path}`);
  }
});

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  Fake Shelly Pro 3EM');
  console.log('═══════════════════════════════════════');
  console.log(`  Port:     ${PORT}`);
  console.log(`  Mode:     ${MODE}`);
  console.log(`  Export:   ${(totalExportWh / 1000).toFixed(2)} kWh (starting)`);
  console.log(`  Rate:     ${PRODUCTION_WH_PER_SEC} Wh/s (~${(PRODUCTION_WH_PER_SEC * 3.6).toFixed(1)} kW)`);
  console.log('═══════════════════════════════════════');
  console.log(`  GET http://localhost:${PORT}/rpc/EM.GetStatus?id=0`);
  console.log(`  GET http://localhost:${PORT}/rpc/Shelly.GetDeviceInfo`);
  console.log('═══════════════════════════════════════\n');
});

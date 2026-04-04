/**
 * JOULE Meter Bridge — Shelly Pro 3EM → JOULE Oracle
 *
 * Reads real energy production from a Shelly Pro 3EM smart meter
 * and reports verified kWh to the JOULE oracle network.
 *
 * Setup:
 *   1. Install Shelly Pro 3EM on your solar/wind/hydro installation
 *   2. Configure SHELLY_IP in .env
 *   3. Run: SHELLY_IP=192.168.1.100 FACILITY_ID=1 node meter-bridge.js
 *
 * This is the physical-world bridge that makes "1 JOL = 1 kWh" REAL.
 */

import { ethers } from 'ethers';

// ─── Config ────────────────────────────────────────────────────

const config = {
  meterType: process.env.METER_TYPE || 'auto',  // 'shelly', 'victron', 'victron-mqtt', 'p1', 'auto'
  meterIp: process.env.METER_IP || '192.168.1.100',
  victronPortalId: process.env.VICTRON_PORTAL_ID || '',  // for MQTT topics
  facilityId: parseInt(process.env.FACILITY_ID || '1'),
  jouleRpc: process.env.JOULE_RPC || 'http://127.0.0.1:8547',
  oracleKey: process.env.ORACLE_PRIVATE_KEY || '',
  pollInterval: parseInt(process.env.POLL_MINUTES || '15') * 60 * 1000,
  oracleContract: process.env.ORACLE_CONTRACT || '',
};

const ORACLE_ABI = [
  'function submitReport(uint256 facilityId, uint256 periodStart, uint256 periodEnd, uint256 kWhProduced) external',
];

// ─── Meter Reading ─────────────────────────────────────────────

/**
 * Read current energy data from Shelly Pro 3EM
 */
async function readShelly(ip) {
  const url = `http://${ip}/rpc/EM.GetStatus?id=0`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!res.ok) throw new Error(`Shelly responded ${res.status}`);

  const data = await res.json();

  return {
    // Total energy in Wh (cumulative since install)
    totalExportWh: data.total_act_ret || 0,  // energy EXPORTED (produced)
    totalImportWh: data.total_act || 0,       // energy imported (consumed)
    // Current power in W
    currentPowerW: data.total_act_power || 0,
    // Phase details
    phases: {
      a: { power: data.a_act_power, voltage: data.a_voltage, current: data.a_current },
      b: { power: data.b_act_power, voltage: data.b_voltage, current: data.b_current },
      c: { power: data.c_act_power, voltage: data.c_voltage, current: data.c_current },
    },
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Read from Victron Energy GX device (Cerbo GX, Venus GX, etc.)
 * Uses Modbus TCP or the local REST API on the GX device.
 * Victron meters: ET340, EM24, EM540
 */
async function readVictron(ip) {
  // Victron GX exposes a local API at port 80
  // Requires "Large" firmware image with Node-RED or Venus OS >= 3.0
  const url = `http://${ip}/api/system/0/Ac/Grid`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();

  // Alternative: Modbus TCP on port 502
  // Register 2600 = grid power L1 (W)
  // Register 2601 = grid power L2 (W)
  // Register 2602 = grid power L3 (W)
  // Register 2634 = total energy forward (kWh * 100)
  // Register 2636 = total energy reverse/export (kWh * 100)

  return {
    totalExportWh: (data.value?.EnergyReverse || 0) * 1000,
    totalImportWh: (data.value?.EnergyForward || 0) * 1000,
    currentPowerW: data.value?.Power || 0,
    phases: {
      a: { power: data.value?.L1?.Power },
      b: { power: data.value?.L2?.Power },
      c: { power: data.value?.L3?.Power },
    },
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Read from Victron via MQTT (VRM / local Venus OS MQTT broker)
 * More reliable for continuous monitoring
 */
async function readVictronMQTT(ip, portalId) {
  // Venus OS runs MQTT broker on port 1883
  // Topics:
  //   N/<portalId>/grid/30/Ac/Energy/Forward   → kWh imported
  //   N/<portalId>/grid/30/Ac/Energy/Reverse   → kWh exported
  //   N/<portalId>/grid/30/Ac/Power            → W current
  //   N/<portalId>/pvinverter/20/Ac/Energy/Forward → PV production kWh
  //   N/<portalId>/pvinverter/20/Ac/Power      → PV power now W

  // For HTTP fallback, use the dbus-spy REST interface
  const url = `http://${ip}:8080/dbus`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const services = await res.json();

  // Find grid meter service
  const gridService = services.find(s => s.includes('com.victronenergy.grid'));
  if (!gridService) throw new Error('No grid meter found on Victron GX');

  // Read values
  const power = await fetch(`http://${ip}:8080${gridService}/Ac/Power`).then(r => r.json());
  const forward = await fetch(`http://${ip}:8080${gridService}/Ac/Energy/Forward`).then(r => r.json());
  const reverse = await fetch(`http://${ip}:8080${gridService}/Ac/Energy/Reverse`).then(r => r.json());

  return {
    totalExportWh: (reverse.value || 0) * 1000,
    totalImportWh: (forward.value || 0) * 1000,
    currentPowerW: power.value || 0,
    phases: {},
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Read from P1 port (Dutch/Belgian smart meters via SlimmeLezer+)
 */
async function readP1(ip) {
  const url = `http://${ip}/api/v1/data`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();

  return {
    totalExportWh: (data.total_power_export_kwh || 0) * 1000,
    totalImportWh: (data.total_power_import_kwh || 0) * 1000,
    currentPowerW: data.active_power_w || 0,
    phases: {},
    timestamp: Math.floor(Date.now() / 1000),
  };
}

// ─── Anomaly Detection ─────────────────────────────────────────

function validateReading(reading, prevReading, facilityCapacityKW) {
  const errors = [];

  // Check 1: Production can't exceed capacity
  if (Math.abs(reading.currentPowerW) > facilityCapacityKW * 1100) {
    errors.push(`Power ${reading.currentPowerW}W exceeds capacity ${facilityCapacityKW}kW`);
  }

  // Check 2: Energy can't decrease (meter rollback = tampering)
  if (prevReading && reading.totalExportWh < prevReading.totalExportWh) {
    errors.push('Export energy decreased — possible meter tampering');
  }

  // Check 3: Impossible production rate
  if (prevReading) {
    const timeDeltaH = (reading.timestamp - prevReading.timestamp) / 3600;
    const energyDeltaKWh = (reading.totalExportWh - prevReading.totalExportWh) / 1000;
    const avgPowerKW = energyDeltaKWh / timeDeltaH;

    if (avgPowerKW > facilityCapacityKW * 1.1) {
      errors.push(`Avg power ${avgPowerKW.toFixed(1)}kW exceeds capacity ${facilityCapacityKW}kW`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Oracle Submission ─────────────────────────────────────────

async function submitToOracle(provider, oracleKey, oracleAddress, facilityId, periodStart, periodEnd, kWh) {
  if (!oracleKey || !oracleAddress) {
    console.log(`[Bridge] Would submit: ${kWh.toFixed(3)} kWh (oracle not configured)`);
    return null;
  }

  const signer = new ethers.Wallet(oracleKey, provider);
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);

  const tx = await oracle.submitReport(
    facilityId,
    periodStart,
    periodEnd,
    Math.floor(kWh) // whole kWh only
  );

  return tx.wait();
}

// ─── Main Loop ─────────────────────────────────────────────────

/**
 * Auto-detect meter type or use configured type
 */
async function detectMeter(ip, type) {
  if (type !== 'auto') return type;

  // Try Shelly
  try {
    await fetch(`http://${ip}/rpc/Shelly.GetDeviceInfo`, { signal: AbortSignal.timeout(2000) });
    console.log('[Bridge] Detected: Shelly Pro 3EM');
    return 'shelly';
  } catch {}

  // Try Victron GX REST
  try {
    await fetch(`http://${ip}:8080/dbus`, { signal: AbortSignal.timeout(2000) });
    console.log('[Bridge] Detected: Victron Energy GX');
    return 'victron-mqtt';
  } catch {}

  // Try Victron API
  try {
    await fetch(`http://${ip}/api/system/0/Ac/Grid`, { signal: AbortSignal.timeout(2000) });
    console.log('[Bridge] Detected: Victron Energy GX (API)');
    return 'victron';
  } catch {}

  // Try P1
  try {
    await fetch(`http://${ip}/api/v1/data`, { signal: AbortSignal.timeout(2000) });
    console.log('[Bridge] Detected: P1 port reader');
    return 'p1';
  } catch {}

  throw new Error(`No supported meter found at ${ip}`);
}

/**
 * Read from detected meter type
 */
async function readMeterByType(type, ip, portalId) {
  switch (type) {
    case 'shelly': return readShelly(ip);
    case 'victron': return readVictron(ip);
    case 'victron-mqtt': return readVictronMQTT(ip, portalId);
    case 'p1': return readP1(ip);
    default: throw new Error(`Unknown meter type: ${type}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  JOULE Meter Bridge v0.2.0');
  console.log('═══════════════════════════════════════');
  console.log(`  Meter IP:  ${config.meterIp}`);
  console.log(`  Facility:  #${config.facilityId}`);
  console.log(`  Interval:  ${config.pollInterval / 60000} minutes`);
  console.log(`  Oracle:    ${config.oracleContract || 'NOT CONFIGURED'}`);
  console.log('═══════════════════════════════════════\n');

  // Detect meter
  let meterType;
  try {
    meterType = await detectMeter(config.meterIp, config.meterType);
    console.log(`[Bridge] Using meter: ${meterType}`);
  } catch (e) {
    console.error(`[Bridge] ${e.message}`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(config.jouleRpc);
  let prevReading = null;
  let totalReportedKWh = 0;

  // Initial reading
  try {
    prevReading = await readMeterByType(meterType, config.meterIp, config.victronPortalId);
    console.log(`[Bridge] Initial reading: ${(prevReading.totalExportWh / 1000).toFixed(2)} kWh total export`);
  } catch (e) {
    console.error(`[Bridge] Cannot read meter: ${e.message}`);
    process.exit(1);
  }

  // Poll loop
  setInterval(async () => {
    try {
      const reading = await readMeterByType(meterType, config.meterIp, config.victronPortalId);

      // Calculate delta
      const deltaKWh = (reading.totalExportWh - prevReading.totalExportWh) / 1000;

      if (deltaKWh > 0) {
        // Validate
        const check = validateReading(reading, prevReading, 50); // TODO: get from registry

        if (check.valid) {
          console.log(`[Bridge] ${new Date().toISOString()} | +${deltaKWh.toFixed(3)} kWh | ${reading.currentPowerW}W`);

          // Submit to oracle
          await submitToOracle(
            provider,
            config.oracleKey,
            config.oracleContract,
            config.facilityId,
            prevReading.timestamp,
            reading.timestamp,
            deltaKWh
          );

          totalReportedKWh += deltaKWh;
          console.log(`[Bridge] Total reported: ${totalReportedKWh.toFixed(3)} kWh = ${totalReportedKWh.toFixed(3)} JOL`);
        } else {
          console.warn(`[Bridge] ANOMALY: ${check.errors.join(', ')}`);
        }
      } else {
        console.log(`[Bridge] ${new Date().toISOString()} | no production | ${reading.currentPowerW}W`);
      }

      prevReading = reading;
    } catch (e) {
      console.error(`[Bridge] Read error: ${e.message}`);
    }
  }, config.pollInterval);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});

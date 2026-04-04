# JOULE Smart Meter Integration Spec

## Toetatud seadmed (prioriteedi järjekorras)

### 1. Shelly Pro 3EM (ESMANE VALIK)
- **Hind:** ~120 EUR
- **Miks:** WiFi, REST API, reaalajas andmed, laialdaselt saadaval
- **Mõõdab:** 3-faasiline energia (import/eksport), võimsus, pinge, vool
- **API:** HTTP REST + MQTT + Websocket
- **Andmepunkt:** `http://<ip>/rpc/EM.GetStatus?id=0` → kWh reaalajas
- **Eesti saadavus:** Jah (osta.ee, Amazon DE)

### 2. P1-port luger (Hollandi/Belgia arvestid)
- **Hind:** ~30 EUR (USB dongle)
- **Miks:** Odav, loeb otse utiliidi arvestit, EU standard
- **Seade:** SlimmeLezer+ (WiFi P1 reader)
- **Protokoll:** DSMR 5.0 telegram → MQTT
- **Eesti:** Elektrilevi arvestitel P1 port olemas

### 3. Victron Energy GX + ET340/EM540
- **Hind:** ~150 EUR (ET340 meter) + ~300 EUR (Cerbo GX) = ~450 EUR täiskomplekt
- **Miks:** Professionaalne, tööstusstandard, Modbus TCP + MQTT + REST API
- **GX seadmed:** Cerbo GX, Venus GX, Ekrano GX
- **Arvestid:** ET340 (3-faasiline), EM24 (DIN-rail), EM540 (kõrge täpsus)
- **API-d:**
  - REST: `http://<gx-ip>/api/system/0/Ac/Grid`
  - MQTT: `N/<portalId>/grid/30/Ac/Energy/Reverse` (eksport kWh)
  - Modbus TCP: port 502, register 2636 (eksport kWh × 100)
  - VRM portaal: pilve kaudu kõik andmed
- **Kasutus:** Päikesepargid, hüdrojaamad, tööstus, suured paigaldised
- **Eelis:** Terve energia süsteem ühes kohas — PV, aku, grid, tarbimineVictron on de facto standard off-grid ja hübriid-energiasüsteemides.
Kui keegi ehitab päikesepargi, on >50% tõenäosusega Victron GX sees.
See tähendab et JOULE meter bridge töötab automaatselt.

## Arhitektuur

```
[Smart Meter] → [WiFi/MQTT] → [JOULE Meter Bridge] → [Oracle Network] → [Blockchain]
     |                              |                        |
  Füüsiline                   Raspberry Pi /            3/5 konsensus
  mõõtmine                    VPS / server              verifitseerib
```

## Meter Bridge tarkvara

Jookseb Raspberry Pi-l või serveril. Loeb arvestiandmeid, saadab oracle'ile.

### Shelly Pro 3EM → JOULE Bridge

```javascript
// meter-bridge.js — reads Shelly Pro 3EM, reports to JOULE oracle

const SHELLY_IP = process.env.SHELLY_IP || '192.168.1.100';
const ORACLE_URL = process.env.ORACLE_URL || 'http://127.0.0.1:8547';
const FACILITY_ID = process.env.FACILITY_ID || '1';
const POLL_INTERVAL = 15 * 60 * 1000; // 15 min

async function readMeter() {
  const res = await fetch(`http://${SHELLY_IP}/rpc/EM.GetStatus?id=0`);
  const data = await res.json();

  return {
    // Shelly Pro 3EM response fields
    totalActiveEnergy: data.total_act,      // Wh total
    totalActivePower: data.total_act_power,  // W current
    phaseA: data.a_act_power,
    phaseB: data.b_act_power,
    phaseC: data.c_act_power,
    voltage: [data.a_voltage, data.b_voltage, data.c_voltage],
    timestamp: Date.now(),
  };
}

async function reportToOracle(reading, prevReading) {
  const kWhDelta = (reading.totalActiveEnergy - prevReading.totalActiveEnergy) / 1000;

  if (kWhDelta <= 0) return; // no production

  console.log(`[Bridge] Reporting ${kWhDelta.toFixed(2)} kWh for facility ${FACILITY_ID}`);

  // Submit to oracle node
  // Oracle node validates and submits to OracleConsensus.sol
}

// Main loop
let prevReading = null;
setInterval(async () => {
  try {
    const reading = await readMeter();
    if (prevReading) {
      await reportToOracle(reading, prevReading);
    }
    prevReading = reading;
  } catch (e) {
    console.error('[Bridge] Error:', e.message);
  }
}, POLL_INTERVAL);
```

## Tamper Protection

Kuidas vältida andmete võltsimist:

1. **MID-sertifitseerimine** — Shelly Pro 3EM on MID-sertifitseeritud (EU mõõteseadmete direktiiv). Riistvara tasemel tamper-proof.
2. **Krüpteeritud transport** — HTTPS/TLS meter → bridge vahel.
3. **Anomaaliate tuvastamine** — Oracle lükkab tagasi kui:
   - Tootmine ületab rajatise nimivõimsust
   - Tootmine kl 2 öösel (päikeseenergia)
   - Äkilised 10x hüpped
4. **Ristkontroll** — Ilmaandmed vs tootmine (päikesepaiste korrelatsioon)
5. **Füüsiline audit** — Registreeritud rajatisi saab kohapeal kontrollida

## Proof-of-Concept samm

### Variant A: Shelly (kiire, odav)
1. Osta Shelly Pro 3EM (~120 EUR, osta.ee)
2. Ühenda restorani/kodu elektripaneelile
3. Käivita: `METER_IP=192.168.1.100 node meter-bridge.js`
4. Esimene reaalne kWh → on-chain → 1 JOL minted

### Variant B: Victron (professionaalne)
1. Kui sul on juba Victron GX süsteem (päikesepaneelid vms)
2. Käivita: `METER_TYPE=victron-mqtt METER_IP=192.168.1.50 node meter-bridge.js`
3. Bridge tuvastab automaatselt Victron GX ja hakkab lugema
4. PV tootmine → on-chain → JOL minted

### Auto-detect
Meter bridge tuvastab automaatselt mis seade on ühendatud:
```bash
METER_IP=192.168.1.100 node meter-bridge.js
# [Bridge] Detected: Shelly Pro 3EM
# või
# [Bridge] Detected: Victron Energy GX
# või
# [Bridge] Detected: P1 port reader
```

Toetatud seadmed:
- Shelly Pro 3EM (WiFi, REST API)
- Victron Cerbo/Venus GX (REST + MQTT + Modbus)
- SlimmeLezer+ P1 port (WiFi, REST)

Mõlemal juhul — see on esimene verifitseeritud kWh JOULE ajaloos.

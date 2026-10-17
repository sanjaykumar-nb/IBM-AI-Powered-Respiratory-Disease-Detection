// Screening audit trail in IBM Db2: one row per screening result. Audio is never stored.
// Db2 is optional for the app: while it is starting or unreachable, writes are logged and skipped
// so screening itself never fails or waits because of the database.
const os = require('os');

const CLASSES = ['Asthma', 'Bronchial', 'COPD', 'Healthy', 'Pneumonia'];
const CHANNELS = ['web', 'whatsapp'];

const {
    DB2_HOST = 'db2',
    DB2_PORT = '50000',
    DB2_DATABASE = 'SCREEN',
    DB2_USER = 'db2inst1',
    DB2_PASSWORD = '',
} = process.env;

const ENABLED = Boolean(DB2_PASSWORD);
const RETRY_AFTER_MS = 15000; // after a failed connect, skip writes this long instead of waiting on Db2 each time
const MAX_PENDING = 50;

let ibmdb = null;
if (ENABLED) {
    try {
        ibmdb = require('ibm_db');
    } catch (e) {
        console.error('IBM Db2 driver (ibm_db) failed to load - screening history disabled:', e.message);
    }
}

const connStr =
    `DATABASE=${DB2_DATABASE};HOSTNAME=${DB2_HOST};PORT=${DB2_PORT};PROTOCOL=TCPIP;` +
    `UID=${DB2_USER};PWD=${DB2_PASSWORD};ConnectTimeout=5;QueryTimeout=10`;

let conn = null;
let connecting = null;
let downUntil = 0;
let lastError = null;
let serverInfo = null; // { arch, version } of the Db2 server, read once per connection
let queue = Promise.resolve(); // one statement at a time on the single connection
let pending = 0;

const SCHEMA = `
CREATE TABLE screenings (
    id                  BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY (NO CACHE) PRIMARY KEY, -- no gaps after a restart
    created_at          TIMESTAMP NOT NULL, -- UTC
    channel             VARCHAR(16) NOT NULL CHECK (channel IN ('web', 'whatsapp')),
    status              VARCHAR(16) NOT NULL CHECK (status IN ('ok', 'refused', 'error')),
    predicted_class     VARCHAR(32),
    confidence          DOUBLE,
    p_asthma            DOUBLE,
    p_bronchial         DOUBLE,
    p_copd              DOUBLE,
    p_healthy           DOUBLE,
    p_pneumonia         DOUBLE,
    refusal_reason      VARCHAR(32),
    q_rms_dbfs          DOUBLE,
    q_peak_dbfs         DOUBLE,
    q_spectral_flatness DOUBLE,
    q_padded_fraction   DOUBLE,
    recording_seconds   DOUBLE,
    inference_ms        DOUBLE,
    server_arch         VARCHAR(16)
)`;

async function ensureSchema(c) {
    const rows = await c.query(
        "SELECT 1 AS n FROM syscat.tables WHERE tabschema = CURRENT SCHEMA AND tabname = 'SCREENINGS'");
    if (rows.length) return;
    await c.query(SCHEMA);
    await c.query('CREATE INDEX screenings_created ON screenings (created_at DESC)');
    console.log('IBM Db2: created table SCREENINGS');
}

async function readServerInfo(c) {
    const info = { arch: null, version: null };
    try {
        const [r] = await c.query('SELECT os_name, os_arch_type FROM TABLE(SYSPROC.ENV_GET_SYSTEM_RESOURCES()) FETCH FIRST 1 ROW ONLY');
        info.arch = r?.OS_ARCH_TYPE?.trim() || null;
    } catch (e) {
        console.warn('IBM Db2: could not read the server architecture:', e.message);
    }
    try {
        const [r] = await c.query('SELECT service_level FROM SYSIBMADM.ENV_INST_INFO');
        info.version = r?.SERVICE_LEVEL?.trim() || null;
    } catch (e) {
        console.warn('IBM Db2: could not read the server version:', e.message);
    }
    return info;
}

async function connect() {
    if (conn) return conn;
    if (Date.now() < downUntil) throw new Error(`IBM Db2 unavailable (${lastError})`);
    if (!connecting) {
        connecting = (async () => {
            try {
                const c = await ibmdb.open(connStr);
                await ensureSchema(c);
                serverInfo = await readServerInfo(c);
                conn = c;
                lastError = null;
                console.log(`IBM Db2: connected to ${DB2_DATABASE} on ${DB2_HOST} (${serverInfo.version || 'Db2'}, ${serverInfo.arch || 'unknown arch'})`);
                return c;
            } catch (e) {
                lastError = e.message.split('\n')[0];
                downUntil = Date.now() + RETRY_AFTER_MS;
                throw e;
            } finally {
                connecting = null;
            }
        })();
    }
    return connecting;
}

function drop() {
    const c = conn;
    conn = null;
    if (c) c.close().catch(() => {});
}

// SQLSTATE class 08 / SQL30081N etc.: the connection is gone (Db2 restarted, network), not a bad statement
function isConnectionError(e) {
    return /^08|^40003/.test(e.state || '') || [-30081, -30108, -1224, -1776, -1032].includes(e.sqlcode)
        || /SQL(30081|30108|1224|1032)N/.test(e.message || '');
}

/** Run fn(connection) serialised on the shared connection; reconnects once if the connection broke (e.g. Db2 restarted). */
function withConnection(fn) {
    const run = queue.then(async () => {
        const hadConnection = Boolean(conn);
        try {
            return await fn(await connect());
        } catch (e) {
            if (!hadConnection || !isConnectionError(e)) throw e;
            console.warn('IBM Db2: connection lost, reconnecting:', e.message.split('\n')[0]);
            drop();
            return fn(await connect());
        }
    });
    queue = run.catch(() => {});
    return run;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The row for one screening, from the ML service's response (ok) or its 422 body (refused). */
function toRow({ channel, status, prediction, refusal }) {
    const probs = prediction?.all_probabilities || {};
    const quality = refusal?.quality || {};
    return [
        CHANNELS.includes(channel) ? channel : 'web',
        status,
        prediction?.predicted_class ?? null,
        num(prediction?.confidence),
        ...CLASSES.map((c) => num(probs[c])),
        refusal?.reason ? String(refusal.reason).slice(0, 32) : null,
        num(quality.rms_dbfs),
        num(quality.peak_dbfs),
        num(quality.spectral_flatness),
        num(quality.padded_fraction),
        num(prediction?.recording_seconds ?? quality.recording_seconds),
        num(prediction?.inference_ms),
        String(prediction?.arch || os.machine()).slice(0, 16),
    ];
}

const INSERT = `INSERT INTO screenings (created_at, channel, status, predicted_class, confidence,
    p_asthma, p_bronchial, p_copd, p_healthy, p_pneumonia, refusal_reason,
    q_rms_dbfs, q_peak_dbfs, q_spectral_flatness, q_padded_fraction,
    recording_seconds, inference_ms, server_arch)
    VALUES (CURRENT TIMESTAMP - CURRENT TIMEZONE, ${Array(17).fill('?').join(', ')})`;

/**
 * Record one screening. Never throws and never delays the caller: call it without awaiting.
 * screening: { channel: 'web'|'whatsapp', status: 'ok'|'refused'|'error', prediction?, refusal? }
 */
function recordScreening(screening) {
    if (!ibmdb) return Promise.resolve();
    if (Date.now() < downUntil && !conn) {
        skipped(lastError);
        return Promise.resolve();
    }
    if (pending >= MAX_PENDING) {
        skipped('write queue full');
        return Promise.resolve();
    }
    pending++;
    const row = toRow(screening);
    return withConnection((c) => c.query(INSERT, row))
        .then(() => {
            if (skippedCount) console.log(`IBM Db2: recording again (${skippedCount} screening(s) were not recorded while it was unavailable)`);
            skippedCount = 0;
        })
        .catch((e) => skipped(e.message))
        .finally(() => pending--);
}

// While Db2 is down, log one line per RETRY_AFTER_MS instead of one per screening
let skippedCount = 0;
let skippedLoggedAt = 0;
function skipped(reason) {
    skippedCount++;
    if (Date.now() - skippedLoggedAt < RETRY_AFTER_MS) return;
    skippedLoggedAt = Date.now();
    const why = String(reason || '').split('\n')[0].replace(/^\[IBM\]\[CLI Driver\]\s*/, '').slice(0, 160);
    console.warn(`IBM Db2 unavailable - screening results not recorded (${skippedCount} so far): ${why}`);
}

// Db2 TIMESTAMP comes back as 'YYYY-MM-DD HH:MM:SS.ffffff'; created_at is stored in UTC
const isoUtc = (ts) => (ts ? `${String(ts).trim().replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1')}Z` : null);

const round = (v, d = 1) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);

/** Recent screenings plus aggregates for the History page. */
async function history(limit = 50) {
    if (!ENABLED) return { available: false, reason: 'IBM Db2 is not configured (DB2_PASSWORD is not set).' };
    if (!ibmdb) return { available: false, reason: 'The IBM Db2 driver could not be loaded on this server.' };

    return withConnection(async (c) => {
        const [totals] = await c.query(`SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) AS refused,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                MIN(created_at) AS first_at
            FROM screenings`);
        const byClass = await c.query(`SELECT predicted_class, COUNT(*) AS n FROM screenings
            WHERE status = 'ok' GROUP BY predicted_class`);
        const byChannel = await c.query(`SELECT channel, COUNT(*) AS n,
                SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) AS refused
            FROM screenings GROUP BY channel`);
        const [latency] = await c.query(`SELECT
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inference_ms) AS median_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY inference_ms) AS p95_ms,
                COUNT(inference_ms) AS n
            FROM screenings WHERE status = 'ok' AND inference_ms IS NOT NULL`);
        const recent = await c.query(`SELECT id, created_at, channel, status, predicted_class, confidence,
                refusal_reason, recording_seconds, inference_ms, server_arch
            FROM screenings ORDER BY id DESC FETCH FIRST ${Math.max(1, Math.min(200, limit | 0))} ROWS ONLY`);

        const total = Number(totals.TOTAL);
        const refused = Number(totals.REFUSED || 0);
        return {
            available: true,
            database: { product: 'IBM Db2', version: serverInfo?.version, arch: serverInfo?.arch, name: DB2_DATABASE },
            total,
            refused,
            errors: Number(totals.ERRORS || 0),
            refusal_rate: total ? refused / total : null,
            first_at: isoUtc(totals.FIRST_AT),
            by_class: Object.fromEntries(CLASSES.map((cls) => [cls, Number(byClass.find((r) => r.PREDICTED_CLASS === cls)?.N || 0)])),
            by_channel: Object.fromEntries(CHANNELS.map((ch) => {
                const r = byChannel.find((x) => x.CHANNEL === ch);
                return [ch, { count: Number(r?.N || 0), refused: Number(r?.REFUSED || 0) }];
            })),
            latency: { median_ms: round(latency.MEDIAN_MS), p95_ms: round(latency.P95_MS), samples: Number(latency.N) },
            recent: recent.map((r) => ({
                id: Number(r.ID),
                created_at: isoUtc(r.CREATED_AT),
                channel: r.CHANNEL,
                status: r.STATUS,
                predicted_class: r.PREDICTED_CLASS,
                confidence: r.CONFIDENCE == null ? null : Number(r.CONFIDENCE),
                refusal_reason: r.REFUSAL_REASON,
                recording_seconds: round(r.RECORDING_SECONDS, 2),
                inference_ms: round(r.INFERENCE_MS),
                server_arch: r.SERVER_ARCH,
            })),
        };
    });
}

module.exports = { recordScreening, history, enabled: () => Boolean(ibmdb) };

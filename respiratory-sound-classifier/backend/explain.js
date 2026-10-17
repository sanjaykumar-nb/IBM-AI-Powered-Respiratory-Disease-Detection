// Plain-language explanation of a screening result, written by IBM Granite on watsonx.ai.
//
// Only the predicted class and the class probabilities are sent to IBM Cloud - never the audio,
// file names or anything about the person. Everything here is optional: without WATSONX_API_KEY and
// WATSONX_PROJECT_ID, or when watsonx.ai is slow or out of quota, callers simply get null.
const axios = require('axios');

const API_KEY = process.env.WATSONX_API_KEY || '';
const PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const URL = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/+$/, '');
const MODEL_ID = process.env.WATSONX_MODEL_ID || 'ibm/granite-3-3-8b-instruct';
const IAM_URL = process.env.WATSONX_IAM_URL || 'https://iam.cloud.ibm.com/identity/token';
const API_VERSION = '2025-02-11';
const TIMEOUT_MS = Number(process.env.WATSONX_TIMEOUT_MS) || 6000;

const CLASSES = ['Asthma', 'Bronchial', 'COPD', 'Healthy', 'Pneumonia'];
const LANGUAGES = { en: 'English', ta: 'Tamil', hi: 'Hindi' };

const enabled = Boolean(API_KEY && PROJECT_ID);

let token = null; // { value, expiresAt }

async function iamToken() {
    if (token && Date.now() < token.expiresAt) return token.value;
    const { data } = await axios.post(
        IAM_URL,
        new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: API_KEY }),
        { timeout: TIMEOUT_MS, headers: { Accept: 'application/json' } },
    );
    // Tokens last an hour; renew a minute early
    token = { value: data.access_token, expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
    return token.value;
}

/** Validate a prediction from the ML service or the browser; returns a clean copy or null. */
function cleanPrediction(p) {
    if (!p || !CLASSES.includes(p.predicted_class)) return null;
    const probs = {};
    for (const c of CLASSES) {
        const v = Number(p.all_probabilities?.[c]);
        if (!Number.isFinite(v) || v < 0 || v > 1) return null;
        probs[c] = v;
    }
    return { predicted_class: p.predicted_class, confidence: probs[p.predicted_class], all_probabilities: probs };
}

// Same bands as the web app (frontend/src/lib/config.js)
function band(p) {
    if (p >= 0.85) return 'high';
    if (p >= 0.6) return 'moderate';
    return 'low';
}

function messages(p, language) {
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const others = Object.entries(p.all_probabilities)
        .filter(([c]) => c !== p.predicted_class)
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `${c} ${pct(v)}`)
        .join(', ');
    return [
        {
            role: 'system',
            content:
                'You help community health workers explain the output of a lung-sound screening tool to patients. ' +
                'The tool compares a 5-second stethoscope recording with recordings labelled Healthy, Asthma, COPD, ' +
                'Pneumonia and Bronchial. It is a screening aid, not a diagnosis. ' +
                'Write 2 or 3 short sentences in plain, calm language: what the result suggests, that only a clinician ' +
                'can diagnose, and when to seek care (urgently if breathing is difficult, lips turn blue, or there is ' +
                'chest pain or high fever). Do not name medicines or doses. Do not use markdown or lists.',
        },
        {
            role: 'user',
            content:
                `Screening result: closest match ${p.predicted_class} (${pct(p.confidence)}, ${band(p.confidence)} agreement). ` +
                `Other classes: ${others}. Write the explanation in ${LANGUAGES[language]}.`,
        },
    ];
}

/**
 * Returns { text, model } or null. Never throws: any failure (no key, timeout, quota, bad input)
 * is logged and turns into null so the screening itself is unaffected.
 */
async function explain(prediction, language = 'en') {
    if (!enabled) return null;
    const p = cleanPrediction(prediction);
    if (!p) return null;
    const lang = LANGUAGES[language] ? language : 'en';
    try {
        const { data } = await axios.post(
            `${URL}/ml/v1/text/chat?version=${API_VERSION}`,
            {
                model_id: MODEL_ID,
                project_id: PROJECT_ID,
                messages: messages(p, lang),
                max_tokens: 200,
                temperature: 0,
            },
            { timeout: TIMEOUT_MS, headers: { Authorization: `Bearer ${await iamToken()}`, Accept: 'application/json' } },
        );
        const text = data?.choices?.[0]?.message?.content?.trim();
        return text ? { text, model: MODEL_ID, language: lang } : null;
    } catch (error) {
        if (error.response?.status === 401) token = null; // expired or revoked: fetch a new one next time
        const detail = error.response?.data?.errors?.[0]?.message || error.response?.status || error.message;
        console.error('watsonx.ai explanation failed:', detail);
        return null;
    }
}

module.exports = { explain, enabled, model: MODEL_ID, LANGUAGES };

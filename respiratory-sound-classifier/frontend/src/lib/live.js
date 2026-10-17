// Live capture for real-time screening: keeps the last few seconds of audio from the microphone
// (or an example recording played as a simulated stethoscope) and turns them into WAV windows.

export const WINDOW_SECONDS = 5; // the model analyses 5 s
const TARGET_RATE = 16000; // the ML service analyses 16 kHz audio
const BLOCK = 2048;

// Runs on the audio thread: forwards each block of input samples to the page
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('tap', Tap);
`;

/** Why the microphone can't be used here, or null if it can. */
export function microphoneProblem() {
  if (!window.isSecureContext) {
    return 'Browsers only allow the microphone on HTTPS or localhost. Open the app over HTTPS (or through an SSH tunnel to localhost), or use a simulated stethoscope below.';
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot record from a microphone.';
  return null;
}

function micError(e) {
  if (e?.name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in the browser’s address bar and try again.';
  if (e?.name === 'NotFoundError') return 'No microphone or stethoscope input was found.';
  if (e?.name === 'NotReadableError') return 'The microphone is in use by another application.';
  return `Could not start the microphone (${e?.message || e}).`;
}

/**
 * Start capturing. source: { kind: 'mic' } or { kind: 'sample', url, label }.
 * Returns a controller: window() -> Float32Array of the last WINDOW_SECONDS (or less), seconds(),
 * level() -> recent RMS in dBFS, sampleRate, stop().
 */
export async function startCapture(source) {
  let stream = null;
  if (source.kind === 'mic') {
    const problem = microphoneProblem();
    if (problem) throw new Error(problem);
    try {
      // Browser voice processing would filter out breath sounds - switch it all off
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      throw new Error(micError(e));
    }
  }

  const ctx = new AudioContext();
  await ctx.resume();
  const rate = ctx.sampleRate;
  const ring = new Float32Array(Math.ceil(rate * WINDOW_SECONDS));
  let written = 0; // total samples received
  let recentSq = 0; // running mean square for the level meter

  const push = (block) => {
    for (let i = 0; i < block.length; i++) {
      ring[(written + i) % ring.length] = block[i];
      recentSq = recentSq * 0.9995 + block[i] * block[i] * 0.0005;
    }
    written += block.length;
  };

  let input;
  let player = null;
  if (stream) {
    input = ctx.createMediaStreamSource(stream);
  } else {
    const data = await (await fetch(source.url)).arrayBuffer();
    player = ctx.createBufferSource();
    player.buffer = await ctx.decodeAudioData(data);
    player.loop = true;
    player.connect(ctx.destination); // audible, like listening through the stethoscope
    input = player;
  }

  // The capture node feeds a muted gain into the speakers: browsers only process nodes that reach the output.
  // AudioWorklet needs a secure context; fall back to ScriptProcessor (deprecated but universal).
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  let tap;
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    tap = new AudioWorkletNode(ctx, 'tap', { channelCount: 1, channelCountMode: 'explicit' });
    tap.port.onmessage = (e) => push(e.data);
  } else {
    tap = ctx.createScriptProcessor(BLOCK, 1, 1);
    tap.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0));
  }
  input.connect(tap);
  tap.connect(mute);
  player?.start();

  return {
    sampleRate: rate,
    label: source.kind === 'mic' ? stream.getAudioTracks()[0]?.label || 'Microphone' : source.label,
    seconds: () => written / rate,
    level: () => 10 * Math.log10(Math.max(recentSq, 1e-12)),
    window() {
      const n = Math.min(written, ring.length);
      const out = new Float32Array(n);
      const start = written - n;
      for (let i = 0; i < n; i++) out[i] = ring[(start + i) % ring.length];
      return out;
    },
    async stop() {
      try {
        player?.stop();
      } catch {
        /* already stopped */
      }
      stream?.getTracks().forEach((t) => t.stop());
      input.disconnect();
      tap.disconnect();
      await ctx.close();
    },
  };
}

/**
 * Low-pass filter and keep every `factor`-th sample (windowed-sinc FIR, Blackman window).
 * Sharp enough to match the server's own resampler on all five example recordings; the browser's
 * built-in resampling (OfflineAudioContext, linear interpolation) changed two of them to "Pneumonia".
 */
function decimate(x, factor) {
  if (factor <= 1) return x;
  const taps = 64 * factor + 1;
  const mid = (taps - 1) / 2;
  const fc = 0.48 / factor; // cut-off just under the new Nyquist frequency, in cycles per input sample
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let n = 0; n < out.length; n++) {
    const c = n * factor - mid;
    let acc = 0;
    for (let k = Math.max(0, -c); k < taps && c + k < x.length; k++) acc += h[k] * x[c + k];
    out[n] = acc;
  }
  return out;
}

/**
 * Encode a window as a mono WAV File, decimated to about 16 kHz (48 kHz -> 16 kHz, 44.1 kHz -> 22.05 kHz;
 * the server resamples the rest of the way).
 *
 * Written as 32-bit float, not 16-bit: the model is sensitive to the near-empty band above 2 kHz in the
 * 4 kHz training recordings, and 16-bit quantisation noise there turned the COPD and Asthma examples
 * into confident "Pneumonia" results.
 */
export function toWavFile(samples, rate, name) {
  const factor = Math.max(1, Math.floor(rate / TARGET_RATE));
  const pcm = decimate(samples, factor);
  const outRate = Math.round(rate / factor);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 4));
  const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, outRate, true);
  view.setUint32(28, outRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, pcm.length * 4, true);
  for (let i = 0; i < pcm.length; i++) view.setFloat32(44 + i * 4, pcm[i], true);
  return new File([view.buffer], name, { type: 'audio/wav' });
}

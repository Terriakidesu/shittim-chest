import { useCallback, useEffect, useRef, useState } from "react";

// Extracted from the game's dedicated audio-sfx_ui-sfx_gacha bundles.
export const RECRUITMENT_SOUNDS = [
  "UI_Gacha_Normal_02b", "UI_Gacha_Normal_04",
  "UI_Gacha_Result_R", "UI_Gacha_Result_SR", "UI_Gacha_Result_SSR",
  "UI_Gacha_Sqr_R", "UI_Gacha_Sqr_SR", "UI_Gacha_Sqr_SSR",
  "UI_Gacha_Result1_01", "UI_Gacha_Result10_01",
] as const;
export type RecruitmentSound = typeof RECRUITMENT_SOUNDS[number];
export type RecruitmentPlayback = { durationMs: number; peakMs: number; elapsedMs: () => number | null };
// Highest sample peak of the shipped arrival MP3 (48 kHz decode). Silent or
// unavailable audio follows this cue, not the clip's 3.764-second tail.
export const REQUEST_REVEAL_PEAK_MS = 1028;

function highestPeakMs(buffer: AudioBuffer) {
  let amplitude = -1;
  let peakFrame = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < samples.length; frame++) {
      const value = Math.abs(samples[frame]);
      if (value > amplitude) { amplitude = value; peakFrame = frame; }
    }
  }
  return peakFrame / buffer.sampleRate * 1000;
}
const STORAGE_KEY = "shittim-simulator-sound-muted";

export function useRecruitmentAudio(blocked: boolean) {
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const engine = useRef<{
    context: AudioContext;
    buffers: Partial<Record<RecruitmentSound, AudioBuffer>>;
    active: Map<AudioBufferSourceNode, { gain: GainNode; cue: RecruitmentSound }>;
    offsets: Partial<Record<RecruitmentSound, number>>;
    unlocked: boolean;
    version: number;
  } | null>(null);
  const disabled = useRef(false);
  disabled.current = muted || blocked;

  const stop = useCallback((fadeMs = 0, preserveDispatch = false) => {
    if (engine.current) engine.current.version++;
    for (const [source, { gain, cue }] of engine.current?.active ?? []) {
      if (preserveDispatch && cue === "UI_Gacha_Normal_04") continue;
      try {
        const now = gain.context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
        source.stop(now + fadeMs / 1000);
      } catch { /* already ended */ }
    }
  }, []);

  useEffect(() => {
    // Decoding is allowed while suspended; playback still requires a gesture.
    let context: AudioContext;
    try { context = new AudioContext(); } catch { return; }
    const audio = { context, buffers: {} as Partial<Record<RecruitmentSound, AudioBuffer>>, offsets: {} as Partial<Record<RecruitmentSound, number>>, active: new Map<AudioBufferSourceNode, { gain: GainNode; cue: RecruitmentSound }>(), unlocked: false, version: 0 };
    engine.current = audio;
    const controller = new AbortController();
    for (const cue of RECRUITMENT_SOUNDS) {
      void fetch(`/ba-sounds/${cue}.mp3`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (engine.current === audio) {
            audio.buffers[cue] = buffer;
            // Align audible attacks, not file starts. Preserve the arrival's
            // complete waveform because its peak drives the request reveal.
            const samples = buffer.getChannelData(0);
            let peak = 0;
            for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
            const onset = samples.findIndex((sample) => Math.abs(sample) > peak * .04);
            audio.offsets[cue] = cue === "UI_Gacha_Normal_02b" ? 0 : Math.max(0, onset / buffer.sampleRate - .005);
          }
        }).catch(() => { /* Missing/unsupported audio must never block recruitment. */ });
    }
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", visibility);
      stop();
      if (engine.current === audio) engine.current = null;
      void context.close().catch(() => {});
    };
  }, [stop]);

  const unlock = useCallback(() => {
    if (disabled.current || document.hidden) return;
    if (engine.current) engine.current.unlocked = true;
    void engine.current?.context.resume().catch(() => {});
  }, []);

  const play = useCallback((cue: RecruitmentSound, layer = false, volume = 1) => {
    const audio = engine.current;
    const buffer = audio?.buffers[cue];
    if (disabled.current || document.hidden || !audio || !audio.unlocked || !buffer) return;
    const preserveDispatch = cue !== "UI_Gacha_Normal_02b" && cue !== "UI_Gacha_Normal_04";
    if (!layer) stop(65, preserveDispatch);
    // Dispatch is a continuous bed through the spread/reveals, not a voice
    // replaced by each card. Duck it gently, but let the source end naturally.
    // Portrait entrances also duck the preceding card's tail more strongly.
    for (const { gain, cue: activeCue } of audio.active.values()) {
      const dispatch = activeCue === "UI_Gacha_Normal_04";
      if (!(dispatch && preserveDispatch) && !layer) continue;
      const now = audio.context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(.45 * (dispatch ? .65 : .28), now + .12);
    }
    const version = audio.version;
    let startedAt: number | null = null;
    const start = () => {
      if (engine.current !== audio || audio.version !== version || disabled.current || document.hidden || audio.context.state !== "running") return;
      const source = audio.context.createBufferSource();
      const gain = audio.context.createGain();
      gain.gain.value = 0.45 * Math.min(1, Math.max(0, volume));
      source.buffer = buffer;
      source.connect(gain).connect(audio.context.destination);
      source.onended = () => { audio.active.delete(source); source.disconnect(); gain.disconnect(); };
      audio.active.set(source, { gain, cue });
      startedAt = audio.context.currentTime;
      source.start(0, audio.offsets[cue] ?? 0);
    };
    if (audio.context.state === "running") start();
    else void audio.context.resume().then(start).catch(() => {});
    return {
      durationMs: buffer.duration * 1000,
      peakMs: cue === "UI_Gacha_Normal_02b" ? highestPeakMs(buffer) : buffer.duration * 1000,
      elapsedMs: () => engine.current === audio && audio.version === version && startedAt !== null
        ? (audio.context.currentTime - startedAt) * 1000 : null,
    } satisfies RecruitmentPlayback;
  }, [stop]);

  useEffect(() => {
    if (muted) stop();
    const audio = engine.current;
    // Suspend rather than discard the source so arrival timing survives rotation.
    if (blocked) void audio?.context.suspend().catch(() => {});
    else if (!muted && audio?.unlocked) void audio.context.resume().catch(() => {});
    try { localStorage.setItem(STORAGE_KEY, String(muted)); } catch { /* private browsing */ }
  }, [muted, blocked, stop]);

  function toggle() {
    disabled.current = !muted || blocked;
    setMuted(!muted);
    if (muted) unlock(); else stop();
  }

  return { muted, toggle, unlock, play, stop };
}

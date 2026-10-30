export interface DecodedAudioTiming {
  end: number;
  duration: number;
}

/** Expand an imported timeline to fit the real decoded audio instead of a guessed two-second block. */
export function decodedAudioTiming(start: number, decodedDuration: number, timelineDuration: number): DecodedAudioTiming | null {
  if (!Number.isFinite(start) || !Number.isFinite(decodedDuration) || decodedDuration <= 0) return null;
  const safeStart = Math.max(0, start);
  const end = Math.max(safeStart + 0.01, safeStart + decodedDuration);
  return { end, duration: Math.max(1, timelineDuration, end) };
}

export interface AudioPlaybackDecision {
  seek: boolean;
  play: boolean;
  started: boolean;
}

/**
 * An HTMLAudioElement stays ended until it is explicitly rewound. Do not call
 * play() on every playhead frame while a long subtitle cue remains active.
 */
export function audioPlaybackDecision(input: {
  active: boolean;
  playing: boolean;
  currentTime: number;
  previousTime: number | undefined;
  started: boolean;
  ended: boolean;
}): AudioPlaybackDecision {
  if (!input.active) return { seek: false, play: false, started: false };
  const rewound = input.previousTime !== undefined && input.currentTime < input.previousTime - 0.05;
  const entered = !input.started || rewound;
  return {
    seek: entered,
    play: input.playing && (entered || !input.ended),
    started: true,
  };
}

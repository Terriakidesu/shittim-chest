export interface SpineAnimationPair {
  main: string;
  face: string | null;
}

export interface SpineInteractionProfile {
  pat: {
    hold: SpineAnimationPair;
    release: SpineAnimationPair | null;
  } | null;
  look: {
    start: SpineAnimationPair;
    end: SpineAnimationPair | null;
  } | null;
  talks: SpineAnimationPair[];
}

function exactAnimation(animations: string[], wanted: string): string | null {
  const lower = wanted.toLocaleLowerCase();
  return animations.find((name) => name.toLocaleLowerCase() === lower) ?? null;
}

function animationBase(name: string): string {
  return name.split("/").pop() ?? name;
}

function faceVariant(animations: string[], main: string): string | null {
  const candidate = main.replace(/_m(?=_|$)/i, "_A");
  return exactAnimation(animations, candidate);
}

function pair(animations: string[], main: string | null): SpineAnimationPair | null {
  return main ? { main, face: faceVariant(animations, main) } : null;
}

function numberIn(name: string): number {
  const match = animationBase(name).match(/(?:pat|talk|look|touch)(?:2)?[_ -]?(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function preferRoot(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const aRoot = Number(!a.includes("/") && !/^dev[ _/]/i.test(a));
    const bRoot = Number(!b.includes("/") && !/^dev[ _/]/i.test(b));
    return bRoot - aRoot || numberIn(a) - numberIn(b) || a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function mainAnimations(animations: string[], kind: "pat" | "look" | "talk" | "touch"): string[] {
  const pattern = kind === "pat"
    ? /(?:^|\/)(?:s_)?pat(?:2)?[_ -]?\d+_m(?:_|$)/i
    : kind === "touch"
      ? /(?:^|\/)touch[_ -]?\d+_m(?:_|$)/i
      : kind === "look"
        ? /(?:^|\/)(?:s_)?look[_ -]?\d+_m(?:_|$)/i
        : /(?:^|\/)talk[_ -]?\d+_m(?:_|$)/i;
  return preferRoot(animations.filter((name) => pattern.test(name) && !/^dev[ _/]/i.test(name)));
}

function endCandidates(main: string, kind: "pat" | "look" | "touch"): string[] {
  const base = animationBase(main);
  const variants: string[] = [];
  if (kind === "look") {
    variants.push(base.replace(/^look/i, "LookEnd"));
  } else if (kind === "touch") {
    variants.push(base.replace(/^touch/i, "TouchEnd"), base.replace(/^touch/i, "Touch_End"));
  } else if (/^pat2/i.test(base)) {
    variants.push(base.replace(/^pat2/i, "Pat2End"), base.replace(/^pat2/i, "PatEnd2"));
  } else {
    variants.push(base.replace(/^pat/i, "PatEnd"));
  }
  return variants;
}

function findEnd(animations: string[], main: string, kind: "pat" | "look" | "touch"): SpineAnimationPair | null {
  for (const candidate of endCandidates(main, kind)) {
    const found = exactAnimation(animations, candidate);
    if (found) return pair(animations, found);
  }
  return null;
}

function findPreferred(animations: string[], names: string[]): string | null {
  for (const wanted of names) {
    const found = exactAnimation(animations, wanted);
    if (found) return found;
  }
  return null;
}

function findPat(animations: string[]): SpineInteractionProfile["pat"] {
  const mains = mainAnimations(animations, "pat");
  const main = findPreferred(animations, ["Pat_01_M", "Pat_01_M_all"]) ?? mains[0]
    ?? mainAnimations(animations, "touch")[0]
    ?? null;
  if (!main) return null;
  const kind = /^touch/i.test(animationBase(main)) ? "touch" : "pat";
  return { hold: pair(animations, main)!, release: findEnd(animations, main, kind) };
}

function findLook(animations: string[]): SpineInteractionProfile["look"] {
  const main = findPreferred(animations, ["Look_01_M", "Look_01_M_all"])
    ?? mainAnimations(animations, "look")[0]
    ?? null;
  if (!main) return null;
  return { start: pair(animations, main)!, end: findEnd(animations, main, "look") };
}

function findTalks(animations: string[]): SpineAnimationPair[] {
  const seen = new Set<string>();
  const talks: SpineAnimationPair[] = [];
  for (const main of preferRoot(mainAnimations(animations, "talk"))) {
    const key = animationBase(main).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    talks.push(pair(animations, main)!);
  }
  return talks.sort((a, b) => numberIn(a.main) - numberIn(b.main) || a.main.localeCompare(b.main, undefined, { sensitivity: "base" }));
}

/**
 * Lobby exports use the same interaction naming convention as the game:
 * M carries the main pose and A carries the face/attachment pose. Keep the
 * name matching tolerant because older exports use Pat2/Touch and a few
 * variants put the animation in a subfolder.
 */
export function findInteractionProfile(animations: string[]): SpineInteractionProfile {
  return {
    pat: findPat(animations),
    look: findLook(animations),
    talks: findTalks(animations),
  };
}

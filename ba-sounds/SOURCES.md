# Original Blue Archive recruitment SFX

Extracted read-only from the user's JP and Global PC installations on 2026-10-14
using UnityPy 1.25.4. No game files were modified. The shipped MP3s are transcoded
from the original AudioClips, not recorded audio, story SFX, or synthesized cues.

## Source bundles

- JP: `audio-sfx_ui-sfx_gacha-_mxload-audio-2025-07-02_assets_all_893479692.bundle`
- Global: `audio-sfx_ui-sfx_gacha-_mxload-2024-11-18_assets_all_2687945115.bundle`

All 32 decoded recruitment clips (including the additional Arona/Plana bundle)
were identical between installations. Only the ten clips used by this simulator
are shipped. `manifest.json` records original clip names, source bundles, decoded
WAV SHA-256 hashes, shipped MP3 hashes, and durations.

## Simulator mapping

| Original clip | Stage |
| --- | --- |
| UI_Gacha_Normal_02b | Signing document appears |
| UI_Gacha_Normal_04 | Paper departure after confirmation; continues across envelope spread |
| UI_Gacha_Result_R / SR / SSR | 1 / 2 / 3-star card face swap / impact |
| UI_Gacha_Sqr_R / SR / SSR | New-student portrait entrance only |
| UI_Gacha_Result1_01 / Result10_01 | Single / ten-pull result summary |

Playback timing is adapted to the 2D simulator, not a claim of frame-exact
reproduction of the original 3D sequence. Duplicates do not play portrait cues.
Post-arrival clips omit only their quiet lead-in (4% of the first channel's
sample peak, with 5ms of pre-roll). The arrival waveform remains untouched.
Card attacks and their effects share the halfway point of each symmetric flip;
portrait cues follow 160ms later and duck the card tail. Cue changes use a 65ms
fade rather than hard cuts. Dispatch has its own lifetime: card/portrait/summary
cues and Next gently duck it to 65% instead of stopping it. It finishes naturally;
Skip, mute, hiding the page, and starting another recruitment still stop it.
The summary cue follows its 180ms settle. Pending
cues pause in portrait and are canceled by Next/Skip, without delayed playback.
There are no unrelated menu/story sounds, music, voice lines, or YouTube samples.

The user's reference, https://www.youtube.com/watch?v=6QZgCI4jlSQ (Adelheid GG,
"Blue Archive Summoning Animation"), was used for timing/signal comparison only.
Normalized waveform comparisons strongly matched Normal_01 (~0.824), Normal_02
(~0.874), and Normal_02b (~0.907); these are corroboration, not listening tests.
The other clips' provenance is the dedicated recruitment banks themselves.

Blue Archive and these assets belong to their respective rights holders,
including Nexon Games, Nexon, and Yostar. They are not covered by the code's
license. Extraction/transcoding does not grant ownership or redistribution rights
and does not imply official endorsement.

# Static lobby artwork

These game assets belong to the Blue Archive rights holders (NEXON Games,
NEXON / Yostar). This is an unofficial fan interface, not an official client.
Attribution does not grant reuse or redistribution rights.

All bundles were read from a locally installed JP client without modifying
the installation. UnityPy was used for read-only extraction.

| Website image | Original bundle / data |
| --- | --- |
| `arona.png` | `prologdepengroup-assets-_mx-spinecharacters-arona_spr-*`, `arona_spr`, `Idle_01` pose |
| `plana.png` | `assets-_mx-spinecharacters-np0035_spr-*`, `NP0035_spr`, `Idle_01` pose |
| `classroom-day.webp` | `assets-_mx-spinebackground-arona_workpage_daytime-*`, `Idle_background_00` |
| `classroom-night.webp` | `assets-_mx-spinebackground-arona_workpage_nighttime-*`, `Idle_background_00` |
| `calendar.webp` | `uis-00_images-bigbtn-*`, `Contents_Image_Mission` |
| `gacha.webp` | `uis-00_images-bigbtn-*`, `Contents_Image_Raid` (terminal illustration, reused as navigation art) |
| `about.webp` | `uis-00_images-bigbtn-*`, `Contents_Image_Story` |

Character and background images were rendered once, offline, using the Spine
4.2.75 WebGL runtime, then cropped and optimized with Pillow. Character PNGs
retain transparency and original proportions. Backgrounds are cropped to the
classroom/ocean composition and encoded as WebP. Labels are accessible HTML,
not text baked into screenshots.

Only static images ship to the browser. No Spine package, skeleton, atlas,
WebGL renderer, canvas, or animation loop is included in the homepage.
See `/about` for the project disclaimer and additional credits.

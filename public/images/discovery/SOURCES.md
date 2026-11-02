# Gallery header assets

## Real photographs by page

Each primary page has a different source photograph. The four new images were retrieved November 2, 2026 and converted to 1600-pixel-wide WebP files. The Me page retains the original picjumbo photograph.

| Page | Local asset | Photographer and original page | Published |
| --- | --- | --- | --- |
| Events | `events-festival-wendy-wei.webp` | [Wendy Wei — People on Concert](https://www.pexels.com/photo/people-on-concert-1179581/) | June 21, 2018 |
| Upgrades | `upgrades-baseball-martin-pechy.webp` | [Martin Péchy — Men Playing Baseball in Stadium](https://www.pexels.com/photo/men-playing-baseball-in-stadium-2763962/) | August 6, 2019 |
| Sell | `sell-theater-tima-miroshnichenko.webp` | [Tima Miroshnichenko — Empty Seats of the Cinema](https://www.pexels.com/photo/empty-seats-of-the-cinema-7991436/) | May 21, 2021 |
| Fan Zone | `fan-zone-crowd-andrius-simkus.webp` | [Andrius Šimkus — A Crowd of People in a Concert](https://www.pexels.com/photo/a-crowd-of-people-in-a-concert-14267300/) | November 1, 2022 |
| Me | `concert-crowd-picjumbo.webp` | [picjumbo.com — Crowd in Front of People Playing Musical Instrument During Nighttime](https://www.pexels.com/photo/crowd-in-front-of-people-playing-musical-instrument-during-nighttime-196652/) | October 16, 2016 |

The Events photograph was taken June 8, 2018 on a Canon EOS 6D. The Upgrades photograph was taken June 2, 2019 on a Sony ILCE-7M2. These are existing photographs, not generated scenes. Direct downloads use `https://images.pexels.com/photos/ID/pexels-photo-ID.jpeg?auto=compress&cs=tinysrgb&w=1600`, with IDs 1179581, 2763962, 7991436, and 14267300 respectively.

All five photographs use the [Pexels license](https://www.pexels.com/license/), which permits use and modification in an app and does not require attribution. They are decorative and do not imply endorsement or identify the nearby event listings. No generative fill, reconstruction, replacement people, or generated lighting was used. Changes are limited to resizing/format compression, per-page CSS framing, and a CSS shade for text readability.

## Retained Me photograph

`concert-crowd-picjumbo.webp` is a resized WebP copy of an existing photograph by **picjumbo.com**, taken September 12, 2015 on a Canon EOS 5D Mark III, published on Pexels October 16, 2016.

- Original page: https://www.pexels.com/photo/crowd-in-front-of-people-playing-musical-instrument-during-nighttime-196652/
- Download: https://images.pexels.com/photos/196652/pexels-photo-196652.jpeg?auto=compress&cs=tinysrgb&w=1600
- License: https://www.pexels.com/license/
- Retrieved November 1, 2026 (America/Phoenix).

## Existing PG artwork

`events-mascot.webp`, `upgrades-mascot.webp`, `sell-mascot.webp`, `fan-zone-mascot.webp`, and `me-mascot.webp` retain the previously approved peanut character and illustrated railing, isolated with fixed vector masks from the former gallery header assets. These are the existing AI-assisted character illustrations, not photographs or newly generated artwork. Their former generated concert scenes are removed.

The original composite files are no longer served by the app. They remain recoverable in Git history at `d50eda0f3d806e43958acf8912cffe4a75fdf407` under `public/images/discovery/*-gallery-hero.webp`.

The live header now renders the photo, a CSS contrast layer, and the transparent character separately. Event-provider images, user-uploaded banners, the PG logo, layout, and controls are unchanged.

# Gallery header assets

## Real photographs by page

Each primary page has a different source photograph. The four new images were retrieved November 2, 2026 and converted to 1600-pixel-wide WebP files. The Me page retains the original picjumbo photograph.

| Page | Local asset | Photographer and original page | Published |
| --- | --- | --- | --- |
| Events | `events-festival-wendy-wei.webp` | [Wendy Wei — People on Concert](https://www.pexels.com/photo/people-on-concert-1179581/) | June 21, 2018 |
| Upgrades | `upgrades-seats-van-anh-nguyen.webp` | [Van Anh Nguyen — Green Seats on Stadium](https://www.pexels.com/photo/green-seats-on-stadium-18960948/) | November 1, 2023 |
| Sell | `sell-theater-tima-miroshnichenko.webp` | [Tima Miroshnichenko — Empty Seats of the Cinema](https://www.pexels.com/photo/empty-seats-of-the-cinema-7991436/) | May 21, 2021 |
| Fan Zone | `fan-zone-crowd-andrius-simkus.webp` | [Andrius Šimkus — A Crowd of People in a Concert](https://www.pexels.com/photo/a-crowd-of-people-in-a-concert-14267300/) | November 1, 2022 |
| Me | `concert-crowd-picjumbo.webp` | [picjumbo.com — Crowd in Front of People Playing Musical Instrument During Nighttime](https://www.pexels.com/photo/crowd-in-front-of-people-playing-musical-instrument-during-nighttime-196652/) | October 16, 2016 |

The Events photograph was taken June 8, 2018 on a Canon EOS 6D. These are existing photographs, not generated scenes. Direct downloads use `https://images.pexels.com/photos/ID/pexels-photo-ID.jpeg?auto=compress&cs=tinysrgb&w=1600`, with IDs 1179581, 18960948, 7991436, and 14267300 respectively.

All five photographs are offered under the [Pexels license](https://www.pexels.com/license/), subject to its [full terms](https://www.pexels.com/terms-of-service/), including restrictions on commercial use of content depicting brands/logos and separate third-party rights. A free photo license is not blanket clearance of those rights. These images are decorative and do not identify the nearby event listings. No generative fill, reconstruction, replacement people, or generated lighting was used. Changes are limited to cropping/resizing/format compression, per-page CSS framing, and a CSS shade for text readability.

## Upgrades replacement — November 2, 2026

The former Dodger Stadium photo (`upgrades-baseball-martin-pechy.webp`, Pexels 2763962) is removed from the served assets because it contains team and sponsor branding. Its replacement is a close-up of numbered green seats, with no visible people, logos, sponsor signs, or venue name in the inspected source image. The portrait source is center-cropped to a 1600 × 1067 landscape WebP; no content is generated or reconstructed. This replacement addresses the Upgrades image only and is not a claim that all third-party rights in the other pages' photos have been independently cleared.

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

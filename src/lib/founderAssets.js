/**
 * Founder story assets — single source of truth for the founder portrait
 * and "Fan Before Founder" photo sequence.
 */

// TEMPORARY_FOUNDER_PORTRAIT
// Replace with the final founder portrait URL when ready. The portrait is
// displayed as a small circular crop with object-position to focus tightly
// on the face, excluding the mascot and surrounding concourse.
export const FOUNDER_PORTRAIT_URL = 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/01324bba6_IMG_3002.PNG';

// Object position for the portrait crop — tightly cropped around the face.
export const FOUNDER_PORTRAIT_OBJECT_POSITION = '18% 28%';

// Alt text for the founder portrait (used for accessibility).
export const FOUNDER_PORTRAIT_ALT = 'Miles Wallace, founder of Peanut Gallery';

// "Fan Before Founder" photo sequence — woven between the childhood and
// WrestleMania chapters. Images are cropped via CSS object-position to
// exclude iOS Photos-app controls and empty borders.
export const FOUNDER_PHOTOS = [
  {
    url: 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/451cfb2cc_IMG_3003.jpg',
    label: 'Where it started',
    alt: 'A young Miles Wallace as a boy at an arena event',
    objectPosition: 'center center',
    rotation: -1.5,
  },
  {
    url: 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/67a8bdd50_IMG_3004.PNG',
    label: 'Phoenix basketball',
    alt: 'Young Miles Wallace in a Phoenix Suns jersey at a basketball arena',
    objectPosition: 'center 42%',
    rotation: 1.2,
  },
  {
    url: 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/553a6b88d_IMG_2998.PNG',
    label: 'Wrestling was never casual',
    alt: 'Miles Wallace holding a Seth Rollins sign at WWE RAW 2017',
    objectPosition: 'center 45%',
    rotation: -1,
  },
  {
    url: 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/c4551a128_IMG_3005.PNG',
    label: 'Arizona baseball',
    alt: 'Miles Wallace and family with D-backs eye black at a night baseball game',
    objectPosition: 'center 42%',
    rotation: 1.5,
  },
];
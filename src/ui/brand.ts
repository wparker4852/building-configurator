// Walker Buildings brand assets, from walkerbuildings.com.
//
// The app loads them as ordinary files. The quote document is a standalone
// HTML blob that may be saved, emailed or printed, so it gets inline data URIs
// that travel with it.

import wordmark from '../assets/brand/walker-wordmark-black.png';
import badge from '../assets/brand/walker-badge.png';
import wordmarkInline from '../assets/brand/walker-wordmark-black.png?inline';
import badgeInline from '../assets/brand/walker-badge.png?inline';

export const BRAND = {
  /** Black WALKER | BUILDINGS wordmark with the circled W, transparent background. */
  wordmark,
  /** The yellow circled-W badge (the site's favicon). */
  badge,
  wordmarkInline,
  badgeInline,
  /** Org palette. */
  colors: {
    yellow: '#FFC301',
    black: '#000000',
    grey: '#575757',
    white: '#FFFFFF',
  },
};

/**
 * Composition Registry
 * --------------------------------------------------------------------
 * Maps composition IDs to their React components.
 * The composition engine (pure logic) lives in compositionEngine.js.
 */
import * as A from './CompositionsA';
import * as B from './CompositionsB';
import * as C from './CompositionsC';

export { A, B, C };

export const COMPOSITION_COMPONENTS = {
  massive_left:        A.MassiveLeft,
  centered_hero:       A.CenteredHero,
  split_layout:        A.SplitLayout,
  magazine_layout:     A.MagazineLayout,
  poster_layout:       B.PosterLayout,
  editorial_layout:    B.EditorialLayout,
  minimal_apple:       B.MinimalApple,
  floating_card:       B.FloatingCard,
  statistic_hero:      C.StatisticHero,
  diagonal_composition: C.DiagonalComposition,
  asymmetric_layout:   C.AsymmetricLayout,
  large_quote:         C.LargeQuote,
};
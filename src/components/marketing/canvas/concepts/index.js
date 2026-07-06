/**
 * Concept Renderer Registry
 * --------------------------------------------------------------------
 * Maps concept IDs to their React renderer components.
 * Each renderer is a fundamentally different visual world.
 */
import * as Poster from './PosterConcepts';
import * as Document from './DocumentConcepts';
import * as Editorial from './EditorialConcepts';
import * as Tech from './TechConcepts';
import * as Atmospheric from './AtmosphericConcepts';
import * as Brand from './BrandConcepts';

export const CONCEPT_RENDERERS = {
  // Poster family
  movie_poster:        Poster.MoviePoster,
  concert_flyer:       Poster.ConcertFlyer,
  street_poster:       Poster.StreetPoster,
  subway_ad:           Poster.SubwayAd,
  neon_sign:           Poster.NeonSign,

  // Document family
  receipt:             Document.Receipt,
  parking_ticket:      Document.ParkingTicket,
  backstage_pass:      Document.BackstagePass,
  vip_wristband:       Document.VIPWristband,
  ticket_stub:         Document.TicketStub,

  // Editorial family
  magazine_cover:      Editorial.MagazineCover,
  minimal_editorial:   Editorial.MinimalEditorial,
  newspaper:           Editorial.Newspaper,
  breaking_news:       Editorial.BreakingNews,
  premium_invitation:  Editorial.PremiumInvitation,
  handwritten_notes:   Editorial.HandwrittenNotes,

  // Tech family
  apple_keynote:       Tech.AppleKeynote,
  tech_launch:         Tech.TechLaunch,
  spotify_wrapped:     Tech.SpotifyWrapped,
  blueprint:           Tech.Blueprint,
  jumbotron:           Tech.Jumbotron,
  seat_map:            Tech.SeatMap,

  // Atmospheric family
  broken_glass:        Atmospheric.BrokenGlass,
  empty_seat:          Atmospheric.EmptySeat,
  spotlight:           Atmospheric.Spotlight,
  arena_lighting:      Atmospheric.ArenaLighting,
  bw_documentary:      Atmospheric.BWDocumentary,

  // Brand family
  luxury_fashion:      Brand.LuxuryFashion,
  sports_broadcast:    Brand.SportsBroadcast,
  financial_report:    Brand.FinancialReport,
  formula_one:         Brand.FormulaOne,
};

export function getConceptRenderer(conceptId) {
  return CONCEPT_RENDERERS[conceptId];
}
/** Worldwide IATA airport catalog for Origin/Destination search.
 * Source: OurAirports public-domain dump (https://ourairports.com/data/).
 * Ranking preference: India & Pakistan first, then hub size, then text match.
 */

import raw from "./airports-data.json";

export type AirportRecord = {
  code: string;
  city: string;
  name: string;
  country: string;
  /** OurAirports type: large_airport | medium_airport | small_airport */
  type: "large_airport" | "medium_airport" | "small_airport";
};

export const AIRPORTS = raw as AirportRecord[];

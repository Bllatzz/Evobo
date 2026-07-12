export type NeoQuery = {
  homeTeam: string;
  awayTeam: string;
  market: string;
};

export type NeoPrediction = {
  raw: string;
  fetchedAt: string;
  source: "neoia";
};

/**
 * Whatever actually talks to Neo IA (or, later, a different source
 * entirely) only needs to implement this one method. NeoIaClient doesn't
 * know or care how the prediction text was obtained — swapping providers
 * means writing a new class here, nothing else changes.
 */
export interface NeoIaSource {
  fetchPrediction(query: NeoQuery): Promise<string>;
}

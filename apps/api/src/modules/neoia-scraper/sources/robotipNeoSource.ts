import type { NeoIaSource, NeoQuery } from "../types.js";

/**
 * NOT IMPLEMENTED YET — blocked on two things, see project memory:
 *
 * 1. Credentials. Neo IA (robotip.com.br/neo) requires being logged in as
 *    a real RobôTip account to get a response at all — it's a conversational
 *    AI feature gated behind auth, not a static page. Needs NEOIA_EMAIL /
 *    NEOIA_PASSWORD (or a session cookie) once the user provides them.
 *
 * 2. The actual request shape. The page is a Vue SPA — you pick "games" /
 *    "leagues" / "teams", then presumably ask a question in a chat UI. This
 *    needs inspecting the network tab while logged in to find out whether
 *    there's a direct chat API to call, or whether this has to drive a
 *    headless browser through the click-through flow. Free tier is capped
 *    at 6 AI credits/day, so whichever approach is used, it must never be
 *    called outside of NeoIaClient's cache+rate-limit wrapper.
 *
 * Swap this whole file for a different NeoIaSource if the user ever moves
 * off Neo IA — nothing else in this module, or its callers, needs to change.
 */
export class RobotipNeoSource implements NeoIaSource {
  async fetchPrediction(_query: NeoQuery): Promise<string> {
    throw new Error(
      "RobotipNeoSource is not implemented — needs Neo IA credentials and the real request flow captured from a logged-in session first.",
    );
  }
}

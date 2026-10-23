import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({ env: {} }));
vi.mock("../db/prisma.js", () => ({ prisma: {} }));
vi.mock("../middleware/extensionKeyGuard.js", () => ({ extensionKeyGuard: vi.fn() }));

const { bookmakerOfUrl } = await import("../modules/betting-queue/routes.js");

describe("bookmakerOfUrl", () => {
  it("recognizes the bookmaker by hostname", () => {
    expect(bookmakerOfUrl("https://www.betano.bet.br/booking/ABC")).toBe("betano");
    expect(bookmakerOfUrl("https://betano.bet.br/x")).toBe("betano");
    expect(bookmakerOfUrl("https://www.bet365.bet.br/s/r/x")).toBe("bet365");
  });

  it("rejects links that only mention the bookmaker", () => {
    for (const url of [
      "https://attacker.example/p?x=betano.bet.br",
      "https://attacker.example?.betano.bet.br/",
      "https://attacker.example#.betano.bet.br/",
      "https://attacker.example/bet365.bet.br/s/r/x",
      "https://betano.bet.br.attacker.example/",
      "http://www.betano.bet.br/",
      "javascript:alert('betano.bet.br')",
    ]) {
      expect(bookmakerOfUrl(url), url).toBeNull();
    }
  });
});

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

// Mirrors server.ts's TRUST_PROXY: the rate limiter keys on request.ip.
const app = Fastify({ trustProxy: ["172.16.0.0/12", "66.241.125.24", "2a09:8280:1::14b:167f:0"] });
app.get("/ip", async (req) => req.ip);

describe("trustProxy", () => {
  it("uses the client IP Fly's proxy put before the app's own IP", async () => {
    const res = await app.inject({ url: "/ip", remoteAddress: "172.19.40.137", headers: { "x-forwarded-for": "6.6.6.6, 200.1.2.3, 66.241.125.24" } });
    expect(res.body).toBe("200.1.2.3");
  });

  it("ignores X-Forwarded-For from a direct client", async () => {
    const res = await app.inject({ url: "/ip", remoteAddress: "8.8.8.8", headers: { "x-forwarded-for": "6.6.6.6" } });
    expect(res.body).toBe("8.8.8.8");
  });
});

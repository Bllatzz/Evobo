import { parseTip } from "../src/parseTip.js";
import { prisma } from "../src/db.js";

const rows = await prisma.telegramTip.findMany({
  where: { parsePattern: { in: ["pct_limit_only", "odd_pct_limit"] }, rawMessage: { not: null } },
  select: { id: true, rawMessage: true, unit: true, result: true },
});

let mismatches = 0;
for (const row of rows) {
  const parsed = parseTip(row.rawMessage, []);
  if (!parsed) {
    console.log(`[NO PARSE] ${row.id}`);
    continue;
  }
  const freshUnit = parsed.selections[0]?.unit ?? null;
  const storedUnit = row.unit !== null ? Number(row.unit) : null;
  if (freshUnit !== storedUnit) {
    mismatches++;
    console.log(`[MISMATCH] ${row.id} stored=${storedUnit} fresh=${freshUnit} result=${row.result}`);
    console.log(`  raw: ${row.rawMessage!.replace(/\n/g, " | ")}`);
  }
}
console.log(`\n${rows.length} rows checked, ${mismatches} mismatch(es)`);
await prisma.$disconnect();

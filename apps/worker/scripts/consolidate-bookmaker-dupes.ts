/**
 * One-off migration for tips created before bookmakerOptions existed: a
 * multi-bookmaker padovan_single message used to fan out into N duplicate
 * TelegramTip rows (one per house). Collapses each duplicate group back into
 * a single row with bookmakerOptions populated, deleting the extras.
 *
 * Safe to re-run — groups of 1 are left untouched.
 */
import { prisma } from "../src/db.js";

async function main() {
  const dupeRows = await prisma.telegramTip.findMany({
    where: { parsePattern: "padovan_single" },
    orderBy: { receivedAt: "asc" },
  });

  const groups = new Map<string, typeof dupeRows>();
  for (const row of dupeRows) {
    const key = `${row.groupId}:${row.telegramMessageId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let consolidated = 0;
  for (const rows of groups.values()) {
    if (rows.length <= 1) continue;

    // Prefer a row that already has user state (taken/result) as the
    // survivor; otherwise keep the earliest.
    const survivor =
      rows.find((r) => r.takenStatus !== "pending" || r.result !== "pending") ?? rows[0]!;
    const options = rows.map((r) => ({ bookmaker: r.bookmaker, betUrl: r.betUrl }));

    await prisma.telegramTip.update({
      where: { id: survivor.id },
      data: { bookmaker: null, betUrl: null, bookmakerOptions: options },
    });
    await prisma.telegramTip.deleteMany({
      where: { id: { in: rows.filter((r) => r.id !== survivor.id).map((r) => r.id) } },
    });
    consolidated++;
    console.log(`consolidated ${rows.length} rows -> ${survivor.id}`, options);
  }

  console.log(`done: ${consolidated} group(s) consolidated`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import { startTelegramWorker } from "./index.js";

startTelegramWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});

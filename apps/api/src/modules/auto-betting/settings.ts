import type { AutoBetSettingsView } from "@evobo/shared-types";
import { prisma } from "../../db/prisma.js";

export const DEFAULT_MAX_STAKE_REAIS = 50;

/**
 * Configuração da aposta automática como o perfil, a extensão e a fila a
 * enxergam. Sem linha salva = desligado, só conferir, teto padrão. O valor da
 * unidade é o mesmo de "Unidade & saldos" (TelegramBancaSettings), não um
 * segundo número.
 */
export async function autoBetSettingsView(userId: string): Promise<AutoBetSettingsView> {
  const [s, banca] = await Promise.all([
    prisma.autoBetSettings.findUnique({ where: { userId } }),
    prisma.telegramBancaSettings.findUnique({ where: { userId }, select: { unitValue: true } }),
  ]);
  return {
    enabled: s?.enabled ?? false,
    placeReal: s?.placeReal ?? false,
    maxStakeReais: s ? s.maxStakeReais.toNumber() : DEFAULT_MAX_STAKE_REAIS,
    enabledSince: s?.enabledSince?.toISOString() ?? null,
    unitValueReais: banca?.unitValue ? banca.unitValue.toNumber() : null,
  };
}

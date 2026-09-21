/** Mapeia o nome de um TelegramGroup pro id do bankroll dele no
 * bet-analytix.com — fixo no código de propósito (só 2 grupos conhecidos
 * hoje, e ainda não existe tela de admin pra editar grupos). Adicionar um
 * grupo novo = adicionar uma linha aqui. */
export const BANKROLL_BY_GROUP_NAME: Record<string, string> = {
  "Lemos Tips EV+ Bets VIP": "1923409",
  "ST - Super Odds de Valor": "1899953",
};

/** Quantos reais vale 1 unidade no bankroll de cada grupo — só usado como
 * DICA no prompt de llmMatch.ts (o stake esperado da tip), pra o modelo
 * entender que um stake menor é limite da casa. Medido nos dados reais
 * (2026-09-21): 154 dos pares únicos do Lemos e 76 do Super Odds têm
 * exatamente 100; os demais são stake reduzido pelo limite. Grupo fora
 * daqui só não recebe a dica. */
export const UNIT_VALUE_BY_GROUP_NAME: Record<string, number> = {
  "Lemos Tips EV+ Bets VIP": 100,
  "ST - Super Odds de Valor": 100,
};

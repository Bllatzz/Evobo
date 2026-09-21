/** Mapeia o nome de um TelegramGroup pro NOME da variável de ambiente que
 * guarda o token da "vitrine pública" dele no Tippy
 * (app.tippybot.com.br/publico/?t=<token>) — mesmo padrão fixo-no-código de
 * betAnalytix/config.ts (adicionar um grupo novo = adicionar uma linha aqui).
 * O token em si fica no ambiente (fly secrets), não no repositório: quem tem
 * o link lê o histórico do canal, e o dono pode revogar/trocar o link sem
 * mexer no código. */
export const TIPPY_TOKEN_ENV_BY_GROUP_NAME: Record<string, string> = {
  "Padovan NBA/NFL": "TIPPY_TOKEN_PADOVAN_NBA_NFL",
};

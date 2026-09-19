'use strict';

// Bots de "menos escanteios" cuja mensagem de alerta no Telegram NÃO inclui
// o total de escanteios (sem linha "Escanteios: X - Y" — só o odd da entrada,
// ex. "Corners under +0.5: 1.62"). Pra esses, `corners_home`/`corners_away`
// (baseline do momento do alerta, usado pelo cornerAutoChecker) precisam ser
// capturados via StatsFeed ao vivo assim que o alerta chega — ver
// telegram.js `fillCornerBaseline`. Sem isso os campos ficam NULL pra sempre
// e o alerta nunca é conferido (era exatamente o bug que deixava esses
// alertas presos em pending indefinidamente).
module.exports = ['Menos de 0,5 escanteios (gratuito)'];

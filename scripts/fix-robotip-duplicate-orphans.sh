#!/bin/sh
# Aplica os 31 resultados órfãos identificados (duplicata do robotip.com.br)
# contra o gêmeo já resolvido do mesmo bot+jogo+URL, enviado pelo mesmo robô
# em menos de 27s de diferença. Gerado em 2026-09-19T14:02:48.591Z.
set -e

echo 'alerta 42260 (Real Sociedad x Bournemouth) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/42260" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 42126 (Atletico Mineiro x Santos) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/42126" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 42052 (Ararat Armenia x Sparta Prague) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/42052" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 41848 (Rayo Vallecano x Espanyol) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/41848" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 41738 (Celta Fortuna x Eibar) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/41738" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 41504 (Panathinaikos x Panetolikos) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/41504" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 41440 (Mallorca x Sabadell) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/41440" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 41069 (Palmeiras x Sao Paulo) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/41069" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 40360 (Cienciano x Torque) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/40360" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 40033 (Fluminense x Platense) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/40033" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 39761 (River Plate x Independiente Rivadavia) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39761" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 39709 (Almeria x Cadiz) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39709" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 39690 (Panathinaikos x PAOK Salonika) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39690" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 39644 (CD Alaves x Osasuna) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39644" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 39638 (OFI Crete x Kifisias FC) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39638" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 39453 (Eibar x Granada) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39453" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 39251 (Philadelphia Union x CF Montreal) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/39251" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 38441 (Nacional Potosi x Real Tomayapo) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/38441" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 38258 (QPR x Cardiff) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/38258" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 37942 (Celta Fortuna x CD Castellon) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37942" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 37781 (EC Bahia x Internacional) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37781" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 37670 (Arezzo x Palermo) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37670" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 37667 (Mallorca x AD Ceuta FC) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37667" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 37360 (Sao Paulo x Bragantino) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37360" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 37312 (Sevilla x Atletico Madrid) -> red'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/37312" -H "Content-Type: application/json" -d '{"result":"red"}' -o /dev/null
sleep 0.15

echo 'alerta 27103 (Nykarleby IK x FC Kiisto) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/27103" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 26864 (Sporting x Celtic) -> reembolso'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/26864" -H "Content-Type: application/json" -d '{"result":"reembolso"}' -o /dev/null
sleep 0.15

echo 'alerta 26848 (Union Santa Fe Reserves x Gimnasia LP Reserves) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/26848" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 26698 (Guangdong GZ-Power U20 x Tianjin Jinmen Tigers U20) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/26698" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'alerta 26501 (Cobreloa x La Serena) -> reembolso'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/26501" -H "Content-Type: application/json" -d '{"result":"reembolso"}' -o /dev/null
sleep 0.15

echo 'alerta 17040 (Croatia U21 x Qatar U23) -> green'
curl -sf -X PATCH "https://evobo-api.fly.dev/robotip/api/alerts/17040" -H "Content-Type: application/json" -d '{"result":"green"}' -o /dev/null
sleep 0.15

echo 'pronto — 31 alertas corrigidos.'

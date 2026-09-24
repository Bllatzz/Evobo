# Evobo Betano (extensão Chrome)

Pega as tips da Betano que chegam no Evobo (via Telegram), abre o link de cada uma, confere as odds, preenche as stakes e — no modo **"Apostar de verdade"** — clica em **APOSTE JÁ** com dinheiro real. No modo **"Só conferir"** preenche e para, sem clicar.

Tudo é controlado pelo Evobo (**Aposta automática**): ligar/desligar, modo (conferir × apostar de verdade), teto por aposta, valor da unidade (Meu perfil → Unidade & saldos) e o login da Betano. A extensão não guarda configuração própria além da chave. O endereço da API é fixo (`background.js`, `API_URL`).

## Instalar
1. No Evobo, **Aposta automática** → baixar a extensão (.zip, gerado a cada deploy pelo `apps/web/scripts/build-extension.mjs`) e descompactar.
2. `chrome://extensions` → "Modo do desenvolvedor" → **"Carregar sem compactação"** → escolher a pasta `evobo-extensao/`.
3. No Evobo, **Gerar chave** (aparece uma vez só) → colar no popup da extensão.

Para desenvolver, dá pra carregar esta pasta direto em vez do .zip.

## Como roda
- A cada poucos segundos pergunta `GET /betting-queue/betano`: tips com link da Betano, uma tarefa por mensagem do Telegram, só as recebidas depois de ligar e que ainda não têm linha no histórico.
- Cada tip abre numa aba; se a Betano estiver deslogada, loga antes com o login cadastrado no Evobo.
- O resultado vai pro histórico do Evobo (`POST /auto-betting/extension/runs`). Aposta de verdade com comprovante → `POST /betting-queue/result`: a API reage 👍 na mensagem do Telegram (👎 se nada entrou) e **depois** grava peguei/não peguei perna por perna.
- **"Testar um link"** (popup): link + odd + unidade digitados; sempre só confere, nunca aposta.
- Tip sem odd/unidade (OCR ainda rodando) espera um pouco antes de desistir.

## Regras
- Odd real **menor** que a da tip → não aposta aquela perna. **Maior** → aposta (nunca barra) e grava a odd real no peguei; o registro oficial fica com a odd da tip.
- Várias simples: a perna com odd menor, suspensa ou não encontrada é pulada; as outras seguem, cada uma no seu campo.
- **Simples + múltipla**: a múltipla só entra se **todas** as simples entraram. Aí as simples são apostadas, o link é reaberto e a múltipla é apostada na aba Múltiplas (decidida pela odd **total**). Se a API não conseguir separar a múltipla das simples, nada é apostado.
- **Múltipla pura** (uma tip, várias seleções no bilhete): vai direto pra aba Múltiplas.
- Número de seleções no bilhete ≠ pernas da tip → aborta sem preencher nada.
- Antes de clicar: replaneja com o bilhete atual, confere o total no botão e marca a aba (sessionStorage) pra nunca clicar duas vezes na mesma tip. Sem comprovante → "verificar" no histórico, nunca tenta de novo.
- A "CA Turbinada" é ligada antes de ler as odds (o "Testar um link" "sem aumento" não mexe nela).

## Testes
`node --test apps/betting-extension/test/*.test.*` — o planejador (puro), o resumo e o orquestrador contra um bilhete **falso** no Chromium do Playwright. O falso valida a lógica, **não** a Betano real — isso se confere no modo "Só conferir" antes de ligar o "Apostar de verdade".

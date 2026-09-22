# Evobo Betano (extensão Chrome)

Lê as tips da Betano que chegam no Evobo (via Telegram), abre o link de cada uma, confere a odd e preenche a stake.
**Dry-run** — preenche as stakes e para; não existe código que clique em "APOSTE JÁ".

## Automático (fase 2)
1. No popup: API do Evobo (`https://evobo-api.fly.dev`, ou `http://localhost:3000` local), a chave da extensão (Perfil → Aposta automática → Gerar chave; só admin) e teto por aposta → Salvar.
2. **Ligar**: a cada 30s pergunta `GET /betting-queue/betano` e processa só as tips que chegarem **depois** de ligar.
3. **Testar agora**: processa as tips das últimas N horas (mesmo as já processadas) — pra testar sem esperar tip nova.
4. Cada tip abre numa aba nova; o resultado (aposta / não aposta e por quê) aparece no Histórico do popup.

Tip sem odd/unidade (OCR ainda rodando) espera até 10 min antes de desistir. A stake usa o valor da unidade da Banca do Evobo.

## Instalar (modo manual, fase 1)
1. `chrome://extensions` → ativar "Modo do desenvolvedor" → "Carregar sem compactação" → escolher esta pasta.
2. Abrir a tip pelo link da Betano (o bilhete já vem montado) e **recarregar a aba (F5)** depois de instalar/atualizar.
3. Clicar no ícone da extensão, colar a tip em JSON e "Rodar dry-run".

## Formato da tip (JSON)
```json
{
  "tipId": "…",
  "unitValueReais": 10,
  "maxStakeReais": 50,
  "limitReais": null,
  "legs": [{ "id": "a", "match": "Time A x Time B", "selection": "Menos de 8.5 …", "odd": 1.65, "unit": 1 }],
  "multiple": { "odd": 1.62, "unit": 2 }
}
```
`maxStakeReais` é obrigatório (teto de segurança por aposta). `multiple` é opcional.

## Regras
- Odd real **menor** que a da tip → não aposta aquela perna. **Maior** → aposta e reporta `takeOdd` (odd a gravar no take pessoal; o registro oficial/admin fica com a odd da tip).
- Várias individuais: a perna com odd menor é ignorada, as certas seguem. A múltipla é decidida pela odd **total** dela.
- Número de seleções no bilhete ≠ pernas da tip → aborta sem preencher nada.
- Odd acima da tip, por maior que seja, **nunca** barra a aposta.

## O que o relatório mostra
`singles.botao` / `multiple.botao`: o texto e o total que a Betano exibiu no botão depois do preenchimento — é o que confirma que a stake entrou certa (e qual separador decimal a Betano aceita).

## Testes
`node --test apps/betting-extension/test/*.test.*` — o planejador (puro) e o orquestrador contra um bilhete **falso** no Chromium do Playwright. O falso valida a lógica; **não** valida a Betano real (isso é o dry-run no seu Chrome).

# Requisitos do Projeto

## REQ-001 — Serviço de busca de indicadores no backend
**Data:** 2026-04-22

1. Criar no backend um serviço que recebe um parâmetro de pesquisa (ex: `8h|rsi|above|70|bellow|99`) e pesquisa em todas as moedas listadas na Binance no momento. Utilizar o método para acesso às moedas e atualizações de valores já criadas no `getClandles` (`backend/binance/getClandles.js`).

2. Na pasta `backend/data/indicators/` salvar em lista o indicador pesquisado. Ex: nome do indicador (`8h|r|a|70|b|99`), data em que foi pesquisado em formato timestamp, e o par da moeda pesquisada com seus valores OHLC e os últimos 20 valores calculados do indicador.

3. No frontend será enviado apenas uma string como parâmetro (ex: `8h|rsi|above|70|bellow|99`), sem precisar enviar candlesticks para o backend, pois já tem tudo salvo na pasta candlestick do backend. O backend apenas atualiza os últimos valores como já é feito pelo método `getClandles.js`.

---

## REQ-002 — Arquivo de requisitos e integração do frontend-react
**Data:** 2026-04-22

1. Sempre que o usuário solicitar algo, adicionar a solicitação como um requisito neste arquivo `requisitos.md` na raiz do projeto.

2. Usar o método criado no frontend-react. O `IndicatorPanel.jsx` ao solicitar no "Analisar Indicadores" enviará apenas a string (ex: `8h|rsi|above|70|bellow|99`) para o novo endpoint do backend, sem enviar candlesticks. O backend faz toda a pesquisa e retorna a lista filtrada. **Nota:** quando o usuário diz "frontend", refere-se ao `frontend-react`.

3. Adicionar `console.log` no frontend e no backend para visualizar os resultados e verificar se a solicitação está sendo feita corretamente.

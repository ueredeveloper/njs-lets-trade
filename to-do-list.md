# To-Do List 

**07/03/2024**

## Tarefas para Hoje:

### Tarefa []: Separar as Linhas Ichimoku
    Verificar as linhas ichimoku no gráfico. Talvez seja melhor agrupar em um botão que abre as  linhas, algo assim.


### Tarefa [X]: Criar um Banco de Dados Local
    Criar um banco local em json utilizando node para moedas favoritas, blacklisted etc.
        30/04/2024 - No momento foi criado um banco com os valores das moedas para pesquisars. Este banco é atualizado ao pesquisar com valores recentes.
    [] - Ainda falta criar as  moedas favoritas etc.

**30/04/2024**
### Tarefa [X]: Filtro de Moedas - Moedas Novas
    Moedas novas não tem como pesquisar no gráfico de 8 horas ichimoku ou média móvel. É preciso adicionar esta exceção na hora das pesquisas. 
        Ver currency-model, moedas pesquisáveis na binance.

        * Foi adicionado.
    
**06/05/2024
### Tarefa []: Verificar espaço temporal entre candles
    Por o banco desktop ser atualizado ao pesquisar, pode ser que demore a pesquisar e o espaço temporal entra uma atualização e outra deixa um vácuo  de candles, por  exemplo: 
        candle de 14:00
            pula candle de 15:00
                atualiza com o candle de 16:00.
      
            
**13/05/2024
### Tarefa []: Filtrar por moedas ruins na binance
    Há moedas que com baixa liquidez, difíceis de vender, o que pode prejudicar o stop loss.

** 20/05/2024
### Tarefa [X]: Adicionar comparações
    No momento estou adicionando o método comparação para depois adicionar a moeda junto com todas as moedas (currency model, all currencies) já informando qual o filtro daquela moeda em específico.

**    21/05/2024
### Tarefa [X]: Filtrar por indicadores
    Criar o filtro por indicadores mostrando as moedas na tabela.
    
** 24/05/2024
### Tarefa []: Limpar apenas alguns  filtros
    Criar opção de limpar apenas alguns filtros. Cria-se vários filtros, porém é preciso a opção de deletar alguns e outros não.

### Tarefa []: Cópia de Candlesticks
    - [] Copiar candlesticks para utilizar com a inteligência e perguntar sobre padrões etc. No caso do Chat Gpt ele não consegue encontrar
    os últimos candles da BTC, por exemplo, tendo que mostrar um json dos últimos candles antes de perguntar.


### Tarefa []: Opções do Usuário
    -   []  Salvar em banco as moedas favoritas do usuário
    -   []  Salvar em banco os indicadores mais utilizados pelo usuário. No meu caso rsi entre 10 e 20 e rsi entre 20 e 30, nos intervalos de 30min, 4h e 8h.

## 16/06/2026
- [] O popup com a área do polígono não está acima do polígono. O ponto superior mais ao norte.


## 22/06/2026
-[] Está entrando várias vezes se o rsi cai vária vezes abaixo de 30, e se passar pela ma501h como segunda entrada, entra também, concorrendo. 
    O preço chega na ma50 1h, este esta tem uma adaptativa que coincide com o stoploss, então a moeda fica entrando e saíndo
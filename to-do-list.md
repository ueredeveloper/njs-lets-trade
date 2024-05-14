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
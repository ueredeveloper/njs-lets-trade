
    // Função para calcular a liquidez de uma lista de ordens
function analyseMoneyFlow(orders) {
    return orders.reduce((total, order) => {
      return total + (parseFloat(order.price) * parseFloat(order.quantity));
    }, 0);
  }

module.exports = analyseMoneyFlow;
  
 

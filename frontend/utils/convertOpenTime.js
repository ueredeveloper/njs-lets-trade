const convertOpenTime = (time, interval) => {
    let conversionTime;

    const options = {
      timeZone: 'America/Sao_Paulo',
    };
    // ajustar 3 minutos à frente
    const adjustedTime = time + (3 * 60 * 1000);
  
    switch (true) {
      case interval.includes('m'):
        conversionTime = new Date(adjustedTime).toLocaleString('pt-BR', { ...options, minute: 'numeric' });
        break;
      case interval.includes('h'):
        conversionTime = new Date(time).toLocaleString('pt-BR', { ...options, hour: 'numeric', hour12: false });
        break;
      case interval.includes('d'):
        conversionTime = new Date(time).toLocaleString('pt-BR', { ...options, day: 'numeric' });
        break;
      case interval.includes('w'):
        const date = new Date(time);
        conversionTime = `${date.getDate()} ${getMonthAbbreviation(date.getMonth())} ${date.getFullYear().toString().slice(2)}`;
        break;
      case interval.includes('M'):
        const monthDate = new Date(time);
        conversionTime = `${getMonthAbbreviation(monthDate.getMonth())} ${monthDate.getFullYear().toString().slice(2)}`;
        break;
      default:
        throw new Error('Invalid interval');
    }
  
    return conversionTime;
  }
  
  // Function to get the abbreviation of the month
  function getMonthAbbreviation(monthIndex) {
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return months[monthIndex];
  }

  export {convertOpenTime}
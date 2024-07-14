
const convertOpenTime = (time, interval) => {
    let conversionTime;

    const options = {
        timeZone: 'America/Sao_Paulo',
    };
    // Adjust 3 minutes ahead
    const adjustedTime = time + (3 * 60 * 1000);

    let date;

    switch (true) {

        case interval.includes('m'):
            conversionTime = new Date(adjustedTime).toLocaleString('pt-BR', { ...options, minute: 'numeric' });
            break;
        case interval.includes('h'):
            conversionTime = new Date(time).toLocaleString('pt-BR', { ...options, hour: 'numeric', hour12: false });
            break;
        case interval.includes('1d'):
            date = addDays(time, 1);
            conversionTime = date.toLocaleString('pt-BR', { ...options, day: 'numeric' });
            break;
        case interval.includes('3d'):
            // Adiciona um dia
            date = addDays(time, 1);
            conversionTime = `${date.getDate()} ${getMonthAbbreviation(date.getMonth())} ${date.getFullYear().toString().slice(2)}`;
            break;
        case interval.includes('1w'):
            // Adiciona um dia
            date = addDays(time, 1);
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

const getMonthAbbreviation = (monthIndex) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames[monthIndex];
}

function addDays(time, days) {
    let result = new Date(time);
    result.setDate(result.getDate() + days);
    return result;
}

module.exports = convertOpenTime;

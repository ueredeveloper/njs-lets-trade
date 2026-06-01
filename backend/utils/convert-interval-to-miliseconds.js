async function convertIntervalToMiliseconds(interval) {

    switch (interval) {
        case '1m':
            return 1 * 60 * 1000;
        case '5m':
            return 5 * 60 * 1000;
        case '15m':
            return 15 * 60 * 1000;
        case '30m':
            return 30 * 60 * 1000;
        case '1h':
            return 1 * 60 * 60 * 1000;
        case '2h':
            return 2 * 60 * 60 * 1000;
        case '4h':
            return 4 * 60 * 60 * 1000;
        case '8h':
            return 8 * 60 * 60 * 1000;
        case '1d':
            return 24 * 60 * 60 * 1000;
        default:
            return 60 * 60 * 1000; // 1h
    }

}

module.exports = convertIntervalToMiliseconds;

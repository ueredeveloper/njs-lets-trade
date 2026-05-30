// Organiza por tipo de intervalo, se 1h, 2h etc.
const sortByTypeOfIntervals = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name));

    return items;
}
// Organiza trazendo primeiro os indicadores de volume que tem a string `Binance` no nome.
const sortFirstIncludesBinance = (items) => {
    items.sort((a, b) => {
        const aIncludes = a.name.includes('Binance');
        const bIncludes = b.name.includes('Binance');

        if (aIncludes && !bIncludes) {
            return -1; // 'a' (with substring) comes first
        } else if (!aIncludes && bIncludes) {
            return 1; // 'b' (with substring) comes first (so 'a' goes after)
        } else {
            // If both or neither include the substring, maintain their relative order
            // or add a secondary sort (e.g., alphabetical)
            return a.name.localeCompare(b.name); // Secondary sort alphabetically

        }
    }
    );
    return items;

}



export {sortByTypeOfIntervals, sortFirstIncludesBinance}
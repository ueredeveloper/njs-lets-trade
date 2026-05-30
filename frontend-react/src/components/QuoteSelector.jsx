import { useCurrency } from '../contexts/CurrencyContext';

export default function QuoteSelector() {
  const { quotes, selectedQuote, setSelectedQuote } = useCurrency();

  return (
    <div className="flex flex-row gap-1">
      {quotes.map((quote) => (
        <button
          key={quote}
          onClick={() => setSelectedQuote(quote)}
          className={`px-3 py-1 text-xs font-semibold tracking-wider rounded uppercase transition-colors ${
            selectedQuote === quote
              ? 'bg-p4 text-white'
              : 'bg-p2 text-p5 hover:bg-p3 hover:text-white'
          }`}
        >
          {quote}
        </button>
      ))}
    </div>
  );
}

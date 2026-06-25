function IconSearch({ className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
      strokeWidth="2" stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

export default function SearchInput({ value, onChange, placeholder, className = '' }) {
  return (
    <div className={`flex items-center gap-1.5 bg-p2/50 border border-p3/30 rounded px-2 py-1 ${className}`}>
      <IconSearch className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-p5 opacity-40 shrink-0" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-p5 text-xs outline-none placeholder-p5/30"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange({ target: { value: '' } })}
          className="text-p5 opacity-50 hover:opacity-90 w-7 h-7 flex items-center justify-center rounded-full hover:bg-p3/30 text-xl leading-none transition-colors shrink-0"
          aria-label="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}

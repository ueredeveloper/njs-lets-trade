/** Ícone de maximizar (setas pra fora) ou dividir tela (retângulo partido ao
 * meio) — usado nos botões de layout do gráfico e do painel de análise. */
export default function MaximizeIcon({ active = false, className = 'w-3.5 h-3.5 shrink-0' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
      strokeWidth="1.75" stroke="currentColor" className={className}>
      {active ? (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path strokeLinecap="round" d="M3.5 12h17" />
        </>
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
      )}
    </svg>
  );
}

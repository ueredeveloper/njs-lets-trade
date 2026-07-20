/** Ícone dos botões de layout do gráfico e do painel de análise.
 *  `kind` escolhe o glifo de "maximizar" (quando !active): 'chart' → candlestick
 *  (botão do gráfico), 'panel' → linhas de painel/lista (botão de indicadores/
 *  estatísticas). Quando `active` (já maximizado), sempre mostra o mesmo ícone
 *  de "dividir tela" (retângulo partido ao meio), independente do kind. */
export default function MaximizeIcon({ active = false, kind = 'chart', className = 'w-3.5 h-3.5 shrink-0' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
      strokeWidth="1.75" stroke="currentColor" className={className}>
      {active ? (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path strokeLinecap="round" d="M3.5 12h17" />
        </>
      ) : kind === 'panel' ? (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path strokeLinecap="round" d="M7 9h10" />
          <path strokeLinecap="round" d="M7 13h10" />
          <path strokeLinecap="round" d="M7 17h6" />
        </>
      ) : (
        <>
          <rect x="4" y="9.5" width="3" height="9.5" rx="0.6" />
          <path strokeLinecap="round" d="M5.5 6v3.5m0 9.5v2" />
          <rect x="10.5" y="5" width="3" height="9" rx="0.6" />
          <path strokeLinecap="round" d="M12 3v2m0 9v3.5" />
          <rect x="17" y="11.5" width="3" height="6" rx="0.6" />
          <path strokeLinecap="round" d="M18.5 8.5v3m0 6v2.5" />
        </>
      )}
    </svg>
  );
}

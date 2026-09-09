import Tooltip from './Tooltip';

/**
 * Tooltip padrão dos controles do painel de indicadores do gráfico. Extraído de
 * CandlestickChart.jsx pra o GroupBox.jsx reusar. Comportamento idêntico ao original.
 */
export default function PanelTip({ text, children, position = 'left' }) {
  return (
    <Tooltip text={text} position={position} maxW={280} portal fill>
      {children}
    </Tooltip>
  );
}

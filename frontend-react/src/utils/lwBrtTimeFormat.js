import { TickMarkType } from 'lightweight-charts';

/** Lightweight Charts formata o eixo de tempo e o crosshair em UTC por padrão (time é
 *  UTCTimestamp em segundos). Aqui forçamos exibição em horário de Brasília (BRT, UTC-3),
 *  igual ao convertOpenTime.js usado no motor antigo (ECharts). */
const BRT_TZ = 'America/Sao_Paulo';

const yearFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, year: 'numeric' });
const monthYearFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, month: 'short', year: 'numeric' });
const dayMonthFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, day: '2-digit', month: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const timeSecFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const crosshairFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRT_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function tickMarkFormatterBrt(time, tickMarkType) {
  const date = new Date(time * 1000);
  switch (tickMarkType) {
    case TickMarkType.Year: return yearFmt.format(date);
    case TickMarkType.Month: return monthYearFmt.format(date);
    case TickMarkType.DayOfMonth: return dayMonthFmt.format(date);
    case TickMarkType.TimeWithSeconds: return timeSecFmt.format(date);
    case TickMarkType.Time:
    default: return timeFmt.format(date);
  }
}

export function crosshairTimeFormatterBrt(time) {
  return crosshairFmt.format(new Date(time * 1000));
}

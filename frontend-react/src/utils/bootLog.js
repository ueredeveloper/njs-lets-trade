/** Logs de diagnóstico da primeira renderização — prefixo [boot] + tempo desde o import. */
const T0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

function elapsed() {
  return `${Math.round(performance.now() - T0)}ms`;
}

export function bootLog(label, detail) {
  if (detail !== undefined) {
    console.log(`[boot +${elapsed()}] ${label}`, detail);
  } else {
    console.log(`[boot +${elapsed()}] ${label}`);
  }
}

export function bootError(label, err) {
  console.error(`[boot +${elapsed()}] ${label}`, err);
}

export function bootWarn(label, detail) {
  if (detail !== undefined) {
    console.warn(`[boot +${elapsed()}] ${label}`, detail);
  } else {
    console.warn(`[boot +${elapsed()}] ${label}`);
  }
}

/** Cronometra uma Promise — loga início, fim ou erro. */
export async function bootTimed(label, fn) {
  bootLog(`${label} → start`);
  const t = performance.now();
  try {
    const result = await fn();
    bootLog(`${label} ← ok (${Math.round(performance.now() - t)}ms)`, {
      type: Array.isArray(result) ? `array[${result.length}]` : typeof result,
    });
    return result;
  } catch (err) {
    bootError(`${label} ← FAIL (${Math.round(performance.now() - t)}ms)`, err);
    throw err;
  }
}

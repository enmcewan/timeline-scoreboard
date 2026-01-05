export function esc(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function minuteToNumber(minStr) {
  if (!minStr) return Number.POSITIVE_INFINITY;

  // Normalize: string, trim, unify apostrophes
  let s = String(minStr).trim().replace(/’/g, "'").toLowerCase();

  // Strip everything except digits and plus signs: "45'+2" -> "45+2"
  s = s.replace(/[^0-9+]/g, "");
 
  if (!s) return Number.POSITIVE_INFINITY;

  let baseStr, extraStr;

  if (s.includes("+")) {
    [baseStr, extraStr] = s.split("+", 2);
  } else {    
    baseStr = s;
    extraStr = "0";
  }
 
  const base = Number(baseStr);
  const extra = Number(extraStr);

  if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY;

  // encode stoppage as fractional part so 45+2 sorts after 45
  const extraFrac = Number.isFinite(extra) ? extra / 100 : 0;

  return base + extraFrac;
}

export function sortedEvents(events) {
  // clone + remember original index so the sort is stable
  const withIndex = (events || []).map((e, idx) => ({ ...e, __idx: idx }));

  function parseMinute(minStr) {
    if (!minStr) return { base: 0, extra: 0 };
    const m = String(minStr).match(/^(\d+)(?:\+(\d+))?/); // 45', 45+2'
    const base = m ? parseInt(m[1], 10) : 0;
    const extra = m && m[2] ? parseInt(m[2], 10) : 0;
    return { base, extra };
  }

  withIndex.sort((a, b) => {
    const ma = parseMinute(a.minute);
    const mb = parseMinute(b.minute);

    if (ma.base !== mb.base) return ma.base - mb.base;
    if (ma.extra !== mb.extra) return ma.extra - mb.extra;

    // stable tie-breaker
    return a.__idx - b.__idx;
  });

  const compressed = [];

  for (let i = 0; i < withIndex.length; i++) {
    const evt = withIndex[i];

    const prev = compressed[compressed.length - 1];

    const isRed = evt.kind === "red";
    const isPrevYellow = prev?.kind === "yellow";

    const samePlayer =
      prev &&
      prev.player === evt.player &&
      prev.team === evt.team &&
      prev.minute === evt.minute;

    // Pattern: yellow then red, same minute / player / team
    if (isRed && isPrevYellow && samePlayer) {
      // Replace the previous yellow with a combined "second yellow + red"
      compressed[compressed.length - 1] = {
        ...evt,
        secondYellow: true,    // <- NEW flag our UI can use
      };
    } else {
      compressed.push(evt);
    }
  }

  // clean up helper field
  return compressed.map(({ __idx, ...rest }) => rest);
}

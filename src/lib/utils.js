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

  function getTimeParts(evt) {
    // Prefer numeric fields from the API transform
    if (typeof evt.elapsed === "number") {
      const base = evt.elapsed ?? 0;
      const extra =
        typeof evt.extra === "number" && evt.extra != null ? evt.extra : 0;
      return { base, extra };
    }

    // Fallback: parse from minute string
    const minStr = evt.minute;
    if (!minStr) return { base: 0, extra: 0 };

    const s = String(minStr);

    // Handle "90'+7", "90'", "90+7"
    const m =
      s.match(/^(\d+)(?:'\+(\d+))?/) || // 90'+7 or 90'
      s.match(/^(\d+)\+(\d+)/) ||       // 90+7
      s.match(/^(\d+)/);                // plain "90"

    const base = m && m[1] ? parseInt(m[1], 10) || 0 : 0;
    const extra = m && m[2] ? parseInt(m[2], 10) || 0 : 0;

    return { base, extra };
  }

  withIndex.sort((a, b) => {
    const ta = getTimeParts(a);
    const tb = getTimeParts(b);

    if (ta.base !== tb.base) return ta.base - tb.base;
    if (ta.extra !== tb.extra) return ta.extra - tb.extra;

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
        secondYellow: true, // UI flag
      };
    } else {
      compressed.push(evt);
    }
  }

  // clean up helper field
  return compressed.map(({ __idx, ...rest }) => rest);
}


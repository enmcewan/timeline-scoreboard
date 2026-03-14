const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function formPoints(formStr) {
    // last 5: W=3, D=1, L=0  -> 0..15
    const s = String(formStr || "").toUpperCase().replace(/[^WDL]/g, "");
    let pts = 0;
    for (const ch of s) pts += ch === "W" ? 3 : ch === "D" ? 1 : 0;
    return pts;
}

// returns swing in [-12..+12], + means AWAY is more "expected stronger"

function expectationSwing({ homeRank, awayRank, homeForm, awayForm }) {
    // If missing data, treat as even
    const hRank = Number.isFinite(homeRank) ? homeRank : null;
    const aRank = Number.isFinite(awayRank) ? awayRank : null;

    const hFormPts = formPoints(homeForm);
    const aFormPts = formPoints(awayForm);

    const formDelta01 = clamp((aFormPts - hFormPts) / 15, -1, 1); // + away better
    let rankDelta01 = 0;

    if (hRank && aRank) {
        // smaller rank is better; if away rank is better, this becomes +
        rankDelta01 = clamp((hRank - aRank) / 19, -1, 1);
    }

    const blended = 0.7 * formDelta01 + 0.3 * rankDelta01;
    return blended * 12;
}

function applyExpectationToPower({ baseHome, baseAway, homeGoals, awayGoals, swing }) {
    // swing > 0 => away expected stronger; swing < 0 => home expected stronger
    const gH = homeGoals ?? 0;
    const gA = awayGoals ?? 0;

    const result = gH > gA ? "homeWin" : gH < gA ? "awayWin" : "draw";

    const expected =
        swing > 0.15 ? "away" :
            swing < -0.15 ? "home" :
                "even";

    // only adjust when outcome contradicts expectation
    let mult = 0;
    if (expected === "home" && result === "awayWin") mult = 3.0;
    else if (expected === "away" && result === "homeWin") mult = 3.0;
    else if (expected !== "even" && result === "draw") mult = 2.0;

    if (!mult) return { home: baseHome, away: baseAway, delta: 0 };

    const bonus = Math.round(Math.abs(swing) * mult);

    if (expected === "home") {
        // away exceeded expectation
        const home = clamp(baseHome - bonus, 0, 100);
        const away = clamp(baseAway + bonus, 0, 100);
        return { home, away, delta: bonus };
    } else {
        // home exceeded expectation
        const home = clamp(baseHome + bonus, 0, 100);
        const away = clamp(baseAway - bonus, 0, 100);
        return { home, away, delta: bonus };
    }
}

function postRedGoalsBonus(teamSide, goalsFor, goalsAgainst, rcMinutes, events) {
    if (!Array.isArray(rcMinutes) || rcMinutes.length === 0) return 0;

    const firstRed = Math.min(...rcMinutes.map(Number).filter(Number.isFinite));
    if (!Number.isFinite(firstRed)) return 0;

    // ignore late reds
    if (firstRed >= 80) return 0;

    let goalsAfterRed = 0;

    for (const e of events || []) {
        if (e.team !== teamSide) continue;

        const minute = Number(e.elapsed ?? 0);
        if (!Number.isFinite(minute) || minute < firstRed) continue;

        // count real goals scored by this team after the red
        if (e.rawType === "Goal" && e.rawDetail !== "Own Goal") {
            goalsAfterRed++;
        }
    }

    if (goalsAfterRed === 0) return 0;

    // strong bonus: scoring after a red is elite execution/game management
    let bonus = goalsAfterRed * 18;

    // extra credit if they still won
    if (goalsFor > goalsAgainst) bonus += 24;

    return bonus;
}

function postRedWinBonus(goalsFor, goalsAgainst, rcMinutes, events, teamSide) {
    if (!Array.isArray(rcMinutes) || rcMinutes.length === 0) return 0;

    const firstRed = Math.min(...rcMinutes.map(Number).filter(Number.isFinite));
    if (!Number.isFinite(firstRed)) return 0;

    // ignore late reds
    if (firstRed >= 70) return 0;

    // only matters if they won
    if (goalsFor <= goalsAgainst) return 0;

    let goalsAfterRed = 0;

    for (const e of events || []) {
        if (e.team !== teamSide) continue;

        const minute = Number(e.elapsed ?? 0);
        if (!Number.isFinite(minute) || minute < firstRed) continue;

        if (e.rawType === "Goal" && e.rawDetail !== "Own Goal") {
            goalsAfterRed++;
        }
    }

    if (goalsAfterRed === 0) return 0;

    // bigger rating bonus for truly epic wins after a red
    return 12 + (goalsAfterRed * 4);
}

function siegeLateLossAdjustment(match, losingSide) {
    const events = match.events ?? [];
    const st = match.statistics ?? {};
    const home = st.home ?? {};
    const away = st.away ?? {};

    const homeGoals = Number(match?.score?.home ?? 0);
    const awayGoals = Number(match?.score?.away ?? 0);

    // only applies to 1-goal matches
    if (Math.abs(homeGoals - awayGoals) !== 1) return 0;

    const winnerSide = homeGoals > awayGoals ? "home" : "away";
    const loserSide = winnerSide === "home" ? "away" : "home";

    if (losingSide !== loserSide) return 0;

    // find decisive goal minute (the winning goal)
    let homeRunning = 0;
    let awayRunning = 0;
    let decisiveMinute = null;

    for (const e of events) {
        if (e.rawType !== "Goal") continue;
        if (e.rawDetail === "Own Goal") continue;

        if (e.team === "home") homeRunning++;
        else if (e.team === "away") awayRunning++;
        else continue;

        const margin = Math.abs(homeRunning - awayRunning);
        const leader = homeRunning > awayRunning ? "home" : awayRunning > homeRunning ? "away" : null;

        if (margin === 1 && leader === winnerSide) {
            decisiveMinute = Number(e.elapsed ?? 0);
        }
    }

    // only late winners count
    if (!Number.isFinite(decisiveMinute) || decisiveMinute < 85) return 0;

    const losingStats = losingSide === "home" ? home : away;

    const lxg = safeNum(losingStats.xg, 0);
    const lBox = safeNum(losingStats.shotsInsideBox, 0);
    const lBlocked = safeNum(losingStats.blockedShots, 0);

    // simple siege test
    const siege =
        (lxg >= 1.0 && lBox >= 8) ||
        (lBox >= 10) ||
        (lBlocked >= 6) ||
        (lBox >= 7 && lBlocked >= 5);

    if (!siege) return 0;

    // console.log(`Applying siege late loss adjustment for ${losingSide} in match ${match.id}`);

    // strength of the adjustment
    let bonus = 0;
    if (lBox >= 10) bonus += 4;
    if (lBlocked >= 6) bonus += 4;
    if (lxg >= 1.2) bonus += 3;

    // base robbery credit
    bonus += 9;

    return bonus; // typically 5..16
}

const safeNum = (v, d = 0) => (Number.isFinite(v) ? v : d);

const poss01 = (s) => {
    const n = typeof s === "string" ? Number(s.replace("%", "")) : Number(s);
    return clamp(Number.isFinite(n) ? n / 100 : 0, 0, 1);
};

export function computePerfExec(match, ctx) {
    const st = match.statistics;
    if (!st?.home || !st?.away) return null;

    const h = st.home;
    const a = st.away;

    // --- Performance / Match Control (mX) ---
    // Relative share + Absolute production hybrid

    const hxg = safeNum(h.xg, 0), axg = safeNum(a.xg, 0);
    const hsotRaw = safeNum(h.sot, 0);
    const asotRaw = safeNum(a.sot, 0);

    const hBlocked = safeNum(h.blockedShots, 0);
    const aBlocked = safeNum(a.blockedShots, 0);

    const hsot = hsotRaw + (hBlocked * 0.3);
    const asot = asotRaw + (aBlocked * 0.3);
    const hshots = safeNum(h.shots, 0), ashots = safeNum(a.shots, 0);
    const hcorn = safeNum(h.corners, 0), acorn = safeNum(a.corners, 0);
    const hposs = poss01(h.poss), aposs = poss01(a.poss);

    const share = (x, y) => (x + y > 0 ? x / (x + y) : 0.5);

    // ----- RELATIVE (0..1) -----
    const rel01 =
        0.35 * share(hxg, axg) +
        0.45 * share(hsot, asot) +
        0.15 * share(hshots, ashots) +
        // 0.10 * share(hposs, aposs) +
        0.05 * share(hcorn, acorn);

    const relHome = rel01 * 100;

    const relAway01 =
        0.35 * share(axg, hxg) +
        0.45 * share(asot, hsot) +
        0.15 * share(ashots, hshots) +
        // 0.10 * share(aposs, hposs) +
        0.05 * share(acorn, hcorn);

    const relAway = relAway01 * 100;

    // ----- ABSOLUTE (0..1) -----
    const cap01 = (v, cap) => clamp(v / cap, 0, 1);

    // caps are intentionally “good-game” levels, not maxima
    const absHome01 =
        0.55 * cap01(hxg, 3.0) +
        0.20 * cap01(hsot, 10) +
        0.10 * cap01(hshots, 25) +
        0.10 * hposs +
        0.05 * cap01(hcorn, 12);

    const absAway01 =
        0.55 * cap01(axg, 3.0) +
        0.20 * cap01(asot, 10) +
        0.10 * cap01(ashots, 25) +
        0.10 * aposs +
        0.05 * cap01(acorn, 12);

    const absHome = absHome01 * 100;
    const absAway = absAway01 * 100;

    // ----- BLEND (0..100) -----
    const REL_W = 0.55;
    const ABS_W = 0.45;

    let homePerf = Math.round(REL_W * relHome + ABS_W * absHome);
    let awayPerf = Math.round(REL_W * relAway + ABS_W * absAway);

    function safeNum(v, d = 0) { return Number.isFinite(Number(v)) ? Number(v) : d; }

    // Ignore cards at/after 70'. Scale earlier ones by time remaining (0..1).
    function cardTimeFactor(minute, cutoff = 70) {
        const m = safeNum(minute, 999);
        if (m >= cutoff) return 0;
        return clamp((cutoff - m) / cutoff, 0, 1); // 69' ~ tiny, 1' ~ almost full
    }

    // Accept either a count, or an array of minutes.
    // Example ctx.homeCards = { yc:[12, 75], rc:[38] }
    function sumCardImpact(cardMinsOrCount, perCardWeight, cutoff = 70) {
        if (Array.isArray(cardMinsOrCount)) {
            return cardMinsOrCount.reduce((acc, min) => acc + perCardWeight * cardTimeFactor(min, cutoff), 0);
        }
        // if it’s a number count (fallback), assume “average” impact pre-cutoff
        const count = safeNum(cardMinsOrCount, 0);
        return count * perCardWeight * 0.5;
    }

    const hYc = ctx?.homeCards?.yc ?? safeNum(h.yc, 0);
    const hRc = ctx?.homeCards?.rc ?? safeNum(h.rc, 0);
    const aYc = ctx?.awayCards?.yc ?? safeNum(a.yc, 0);
    const aRc = ctx?.awayCards?.rc ?? safeNum(a.rc, 0);

    // time-weighted: yellows are small, reds larger
    const hCardPenalty =
        sumCardImpact(hYc, 0.4) + sumCardImpact(hRc, 2.5);
    const aCardPenalty =
        sumCardImpact(aYc, 0.4) + sumCardImpact(aRc, 2.5);

    homePerf = clamp(Math.round(homePerf - hCardPenalty), 0, 100);
    awayPerf = clamp(Math.round(awayPerf - aCardPenalty), 0, 100);

    // --- Execution ---
    // const hg = safeNum(match.score?.home, 0);
    // const ag = safeNum(match.score?.away, 0);

    const hgRaw = safeNum(match.score?.home, 0);
    const agRaw = safeNum(match.score?.away, 0);

    const hDis = safeNum(ctx?.homeDisallowedGoals, 0);
    const aDis = safeNum(ctx?.awayDisallowedGoals, 0);

    const hOwn = safeNum(ctx?.homeOwnGoalsFor, 0);
    const aOwn = safeNum(ctx?.awayOwnGoalsFor, 0);

    const DIS_GOAL_FACTOR = 0.7;
    const OWN_GOAL_FACTOR = 0.301;

    // eX only: own goals get partial credit, disallowed goals get strong partial credit
    const hg = (hgRaw - hOwn) + (hOwn * OWN_GOAL_FACTOR) + (hDis * DIS_GOAL_FACTOR);
    const ag = (agRaw - aOwn) + (aOwn * OWN_GOAL_FACTOR) + (aDis * DIS_GOAL_FACTOR);

    const deltaCap = 2.5;
    const hDeltaN = clamp((hg - hxg), -deltaCap, deltaCap) / deltaCap; // -1..1
    const aDeltaN = clamp((ag - axg), -deltaCap, deltaCap) / deltaCap;

    const POS_M = 45;   // was effectively 22
    const NEG_M = 22;   // keep as-is

    // 0-goal baseline scales down with xG (more xG + 0 goals = worse eX)
    const zeroGoalBase = (xg) => 40 - clamp(xg * 6, 0, 15); // 40..25

    const baseExec = (goals, xg) => (goals === 0 ? zeroGoalBase(xg) : 50);

    let homeExec = Math.round(baseExec(hg, hxg) + hDeltaN * (hDeltaN >= 0 ? POS_M : NEG_M));
    let awayExec = Math.round(baseExec(ag, axg) + aDeltaN * (aDeltaN >= 0 ? POS_M : NEG_M));

    // keeper impact (subtle)
    homeExec += Math.round(clamp(safeNum(h.goalsPrevented, 0), -2, 2) * 3);
    awayExec += Math.round(clamp(safeNum(a.goalsPrevented, 0), -2, 2) * 3);

    // waste penalty (this is the “Forest blew it” lever)
    const wastePenalty = (xg, goals) => {
        if (xg >= 2.3 && goals === 0) return 14;
        if (xg >= 2.0 && goals === 0) return 12;
        if (xg >= 1.7 && goals === 0) return 10;
        if (xg >= 2.5 && goals <= 1) return 8;
        if (xg >= 1.8 && goals <= 1) return 5;
        return 0;
    };

    homeExec -= wastePenalty(hxg, hg);
    awayExec -= wastePenalty(axg, ag);

    function minuteWeight(min) {
        const m = Number(min ?? 0);
        if (!Number.isFinite(m)) return 1;

        if (m >= 70) return 0;      // ignore late
        if (m <= 20) return 1;      // full impact early

        // 20..70 fades 1 -> 0
        return (70 - m) / 50;
    }

    function cardPenalty({ ycMinutes = [], rcMinutes = [], ycCount = 0, rcCount = 0 }) {
        // tuned to feel like football:
        // - YC is mild unless early & repeated
        // - RC is a big deal early
        const YC_MAX = 99;     // cap total YC damage
        const RC_BASE = 18;   // “full” red card penalty when early

        let yc = 0;
        for (const m of ycMinutes) yc += 2.41421 * minuteWeight(m);
        yc = Math.min(yc, YC_MAX);

        let rc = 0;
        for (const m of rcMinutes) rc += RC_BASE * minuteWeight(m);

        // fallback if you didn't provide minutes
        // if (!ycMinutes.length) yc = Math.min(2888.41421 * ycCount, YC_MAX);
        // if (!rcMinutes.length) rc = RC_BASE * rcCount;

        return yc + rc;
    }

    const hCard = cardPenalty({
        ycMinutes: ctx?.homeCards?.yc ?? [],
        rcMinutes: ctx?.homeCards?.rc ?? [],
        ycCount: safeNum(h.yc, 0),
        rcCount: safeNum(h.rc, 0),
    });

    const aCard = cardPenalty({
        ycMinutes: ctx?.awayCards?.yc ?? [],
        rcMinutes: ctx?.awayCards?.rc ?? [],
        ycCount: safeNum(a.yc, 0),
        rcCount: safeNum(a.rc, 0),
    });

    homeExec -= Math.round(hCard);
    awayExec -= Math.round(aCard);

    // homeExec = clamp(homeExec, 0, 100);
    // awayExec = clamp(awayExec, 0, 100);

    const homeGoals = Number(match?.score?.home ?? 0);
    const awayGoals = Number(match?.score?.away ?? 0);

    homeExec += postRedGoalsBonus(
        "home",
        homeGoals,
        awayGoals,
        ctx?.homeCards?.rc ?? [],
        match.events
    );

    awayExec += postRedGoalsBonus(
        "away",
        awayGoals,
        homeGoals,
        ctx?.awayCards?.rc ?? [],
        match.events
    );

    // --- Dominance floor for eX (execution) ---
    // If you win comfortably and created enough, don't let xG delta make eX look mediocre.
    function applyDominanceFloor(exec, goalsFor, goalsAgainst, xg) {
        const gd = goalsFor - goalsAgainst;

        // trigger: comfortable win + real chance creation
        if (gd >= 2 && goalsFor >= 2 && xg >= 1.8) {
            let floor = 60;          // GD = 2
            if (gd >= 3) floor = 70; // GD 3+
            if (goalsFor >= 4) floor = Math.max(floor, 75);
            return Math.max(exec, floor);
        }
        return exec;
    }

    homeExec = applyDominanceFloor(homeExec, homeGoals, awayGoals, hxg);
    awayExec = applyDominanceFloor(awayExec, awayGoals, homeGoals, axg);

    // extra penalty when you score but still under-hit xG
    function underHitPenalty(xg, goals) {
        if (goals <= 0) return 0;                 // 0-goal games handled elsewhere
        const miss = xg - goals;                  // positive if under-hit
        if (miss <= 0) return 0;
        return Math.round(clamp(miss * 11, 0, 12)); // 0.5 miss ≈ -6
    }

    homeExec -= underHitPenalty(hxg, hg);
    awayExec -= underHitPenalty(axg, ag);

    function applyNoThreatCap(exec, goalsFor, xg, sot, shots, disallowedGoals) {
        // If they actually got the ball in the net (VAR disallowed), don't call it "no threat"
        if (safeNum(disallowedGoals, 0) > 0) return exec;

        if (goalsFor !== 0) return exec;

        const XG = safeNum(xg, 0);
        const SOT = safeNum(sot, 0);
        const SH = safeNum(shots, 0);

        // Truly nothing happened -> allow zero
        if (XG < 0.10 && SOT === 0 && SH <= 2) {
            return 0;
        }

        // "Did fuck all" cap
        // low xG OR no shots-on-target (and no disallowed goals)
        if (XG < 0.30 || SOT === 0) {
            return Math.min(exec, 10);
        }

        return exec;
    }

    homeExec = applyNoThreatCap(homeExec, hg, hxg, hsot, hshots, hDis);
    awayExec = applyNoThreatCap(awayExec, ag, axg, asot, ashots, aDis);

    homeExec = clamp(homeExec, 0, 100);
    awayExec = clamp(awayExec, 0, 100);

    const baseHomePower = clamp(Math.round(homePerf * 0.65 + homeExec * 0.35), 0, 100);
    const baseAwayPower = clamp(Math.round(awayPerf * 0.65 + awayExec * 0.35), 0, 100);

    // ---- expectation modifier (rank + form) ----
    const swing = expectationSwing({
        homeRank: ctx?.homeRank,
        awayRank: ctx?.awayRank,
        homeForm: ctx?.homeForm,
        awayForm: ctx?.awayForm,
    });

    const adj = applyExpectationToPower({
        baseHome: baseHomePower,
        baseAway: baseAwayPower,
        homeGoals,
        awayGoals,
        swing,
    });
    // -------------------------------------------

    function resultAnchor(goalsFor, goalsAgainst) {
        const gd = goalsFor - goalsAgainst;
        const totalGoals = goalsFor + goalsAgainst;

        let base;
        if (gd > 0) base = 60 + clamp(Math.abs(gd) * 3, 3, 12);
        else if (gd < 0) base = 40 - clamp(Math.abs(gd) * 3, 3, 12);
        else base = 50;

        // competitiveness in a LOSS (3–2 feels different than 2–0)
        if (gd < 0) {
            if (goalsFor >= 2) base += 4;
            else if (goalsFor === 1) base += 2;
            else base -= 2; // 0 goals in a loss
        }

        // match intensity (high/low event)
        if (totalGoals >= 5) base += 2;
        if (totalGoals <= 1) base -= 2;

        return clamp(Math.round(base), 0, 100);
    }

    function applyExpectation(anchor, expectN) {
        // expectN should be -1..+1 (underdog positive)
        const up = 12, down = 10;
        const delta = expectN >= 0 ? expectN * up : expectN * down;
        return anchor + delta;
    }

    function nudgeFromPerfExec(perf, exec) {
        const perfN = (perf - 50) / 50; // -1..+1
        const execN = (exec - 50) / 50; // -1..+1
        return (perfN * 6) + (execN * 8);
    }

    function anchoredRating({ side, perf, exec, expectN }) {
        const rawGoalsFor = side === "home" ? homeGoals : awayGoals;
        const rawGoalsAgainst = side === "home" ? awayGoals : homeGoals;

        let r = resultAnchor(rawGoalsFor, rawGoalsAgainst);

        // Low-quality narrow-win clip:
        // if a team only wins by 1 in a low-threat match, don't let the anchor run too hot
        const gd = rawGoalsFor - rawGoalsAgainst;
        const totalXg = hxg + axg;
        const totalSot = hsotRaw + asotRaw;

        if (gd === 1 && totalXg < 2.2 && totalSot <= 5) {
            r -= 10;
            // console.log("Low-quality narrow-win clip");
        }

        r = applyExpectation(r, expectN);

        // console.log({ swing, homeExpectN, awayExpectN });

        if (rawGoalsFor === rawGoalsAgainst) {
            if (expectN > 0) {
                r += Math.round(expectN * 8);
                // console.log("Underdog draw bonus");
            } else if (expectN < 0) {
                r += Math.round(expectN * 4);
                // console.log("Favorite draw clip");
            }
        }

        const UPSET_THRESHOLD = 0.35;

        if (rawGoalsFor > rawGoalsAgainst) {
            if (expectN > UPSET_THRESHOLD) {
                r += Math.round(expectN * 10);
                // console.log("Underdog win bonus");
            }
        } else if (rawGoalsFor < rawGoalsAgainst) {
            if (expectN < -UPSET_THRESHOLD) {
                r += Math.round(expectN * 6);
                // console.log("Favorite loss clip");
            }
        }

        r += nudgeFromPerfExec(perf, exec);
        return clamp(Math.round(r), 0, 100);
    }

    // IMPORTANT: use your existing expectation numbers.
    // If your `swing` is -12..+12 where + means away stronger, then:
    const homeExpectN = clamp((swing) / 12, -1, 1);
    const awayExpectN = clamp((-swing) / 12, -1, 1);

    const anchoredHome = anchoredRating({
        side: "home",
        perf: homePerf,
        exec: homeExec,
        expectN: homeExpectN
    });

    const anchoredAway = anchoredRating({
        side: "away",
        perf: awayPerf,
        exec: awayExec,
        expectN: awayExpectN
    });

    const homePostRedWin = postRedWinBonus(
        homeGoals,
        awayGoals,
        ctx?.homeCards?.rc ?? [],
        match.events,
        "home"
    );

    const awayPostRedWin = postRedWinBonus(
        awayGoals,
        homeGoals,
        ctx?.awayCards?.rc ?? [],
        match.events,
        "away"
    );

    const homeSiegeLateLoss = siegeLateLossAdjustment(match, "home");
    const awaySiegeLateLoss = siegeLateLossAdjustment(match, "away");

    let homePower =
        anchoredHome +
        safeNum(ctx?.homeDisallowedGoals, 0) * 3 +
        homePostRedWin +
        homeSiegeLateLoss -
        awaySiegeLateLoss;

    let awayPower =
        anchoredAway +
        safeNum(ctx?.awayDisallowedGoals, 0) * 3 +
        awayPostRedWin +
        awaySiegeLateLoss -
        homeSiegeLateLoss;

    // --- Winner guardrail for Rating ---
    // Winner should never finish below loser.
    const WINNER_TOLERANCE = 0;

    if (homeGoals > awayGoals) {
        const minHome = awayPower - WINNER_TOLERANCE;
        if (homePower < minHome) homePower = minHome;
    } else if (awayGoals > homeGoals) {
        const minAway = homePower - WINNER_TOLERANCE;
        if (awayPower < minAway) awayPower = minAway;
    }

    // --- Final result authority override ---
    // Result has the last word. If a team wins, it must finish clearly ahead.
    const FINAL_WINNER_MARGIN = 5;

    if (awayGoals > homeGoals && awayPower <= homePower) {
        awayPower = homePower + FINAL_WINNER_MARGIN;
    } else if (homeGoals > awayGoals && homePower <= awayPower) {
        homePower = awayPower + FINAL_WINNER_MARGIN;
    }

    homePower = clamp(Math.round(homePower), 0, 100);
    awayPower = clamp(Math.round(awayPower), 0, 100);

    return {
        homePerf,
        awayPerf,
        homeExec,
        awayExec,

        baseHomePower,
        baseAwayPower,

        // headline number (uses expectation + outcome anchor)
        // homePower: anchoredHome,
        // awayPower: anchoredAway,
        homePower,
        awayPower,

        // debugging / display if you want
        expectationSwing: swing,   // -12..+12 (away stronger if +)
        expectationApplied: adj.delta, // 0 if not applied
    };
}
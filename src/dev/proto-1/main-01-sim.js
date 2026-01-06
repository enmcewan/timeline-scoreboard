import "./style.css";
import teams from "./data/leagues/epl/teams.json";
import matchData from "./data/leagues/epl/match.sample.json";

let liveMatch = JSON.parse(JSON.stringify(matchData));

liveMatch.events ||= [];
for (const evt of liveMatch.events) {
  evt.id ||= crypto.randomUUID();
}

const app = document.querySelector("#app");
app.innerHTML = renderMatchHeader(liveMatch);

// cache nodes
const dom = {
    scoreHome: app.querySelector(".score-home"),
    scoreAway: app.querySelector(".score-away"),
    statusState: app.querySelector(".match-status .full-time"),
    statusHT: app.querySelector(".match-status .half-time"),
    body: app.querySelector(".match-body"),
};

const eventNodes = new Map();     // id -> DOM node
const eventHtml = new Map();      // id -> last rendered HTML (optional, for updates)

function nodeFromHTML(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// tracking for diffing
let renderedEventCount = 0;

function updateHeaderAndStatus(match) {
  // score
  dom.scoreHome.textContent = String(match.score.home);
  dom.scoreAway.textContent = String(match.score.away);

  // status
  dom.statusState.textContent = match.status?.state ?? "";
  dom.statusHT.textContent = match.status?.halfTimeScore
    ? `(${match.status.halfTimeScore})`
    : "";
}

// function appendNewEvents(match) {
//   const events = sortedEvents(match.events);

//   // If ordering can change (sorting), append-only isn’t safe unless we track IDs.
//   // For now: if count changed, we append the last items (works if sim only appends).
//   if (events.length <= renderedEventCount) return;

//   const newEvents = events.slice(renderedEventCount);
//   for (const evt of newEvents) {
//     dom.body.insertAdjacentHTML("beforeend", renderEventRow(evt));
//   }

//   renderedEventCount = events.length;
// }

function syncEvents(match) {
  const events = sortedEvents(match.events || []);

  const frag = document.createDocumentFragment();

  for (const evt of events) {
    // guarantee id even if API forgets (belt + suspenders)
    evt.id ||= crypto.randomUUID();

    const html = renderEventRow(evt).trim();
    let node = eventNodes.get(evt.id);

    if (!node) {
      node = nodeFromHTML(html);
      node.dataset.eventId = evt.id;
      eventNodes.set(evt.id, node);
      eventHtml.set(evt.id, html);
    } else {
      // If an existing event gets updated (rare but possible with real feeds)
      if (eventHtml.get(evt.id) !== html) {
        const newNode = nodeFromHTML(html);
        newNode.dataset.eventId = evt.id;
        eventNodes.set(evt.id, newNode);
        eventHtml.set(evt.id, html);
        node = newNode;
      }
    }

    frag.appendChild(node);
  }

  dom.body.replaceChildren(frag);
}


function renderDiff(match) {
  updateHeaderAndStatus(match);
//   appendNewEvents(match);
  syncEvents(match);

}

function esc(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function minuteToNumber(minStr) {
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

function sortedEvents(events) {
  if (!events || !events.length) return [];

  // sort is stable in modern JS, so equal minutes keep original order
  return [...events].sort((a, b) => {
    const da = minuteToNumber(a.minute);
    const db = minuteToNumber(b.minute);
    return da - db;
  });
}

function renderMatchHeader(match) {

    const home = teams[match.homeTeamId];
    const away = teams[match.awayTeamId];

    if (!home || !away) {
        throw new Error(`Unknown team id(s): ${match.homeTeamId}, ${match.awayTeamId}`);
    }

    const statusLine = esc(match.status?.state ?? "");
    const ht = match.status?.halfTimeScore ? `(${esc(match.status.halfTimeScore)})` : "";
    const eventsHtml = (match.events || []).map(renderEventRow).join("");

    const attendance = Number(match.attendance);
    const attendanceText = Number.isFinite(attendance) ? attendance.toLocaleString() : "";

    return `
    <div class="match-card">
      <div class="league-name">${esc(match.league)}</div>
      <header class="match-header">
        <div class="ht-cont">
          <div class="team home">${esc(home.name)}</div>
          <img class="team-badge" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
        </div>
        <div class="score">
            <div class="score-home">${esc(match.score.home)}</div>
            <span class="separator" aria-hidden="true"></span>
            <div class="score-away">${esc(match.score.away)}</div>
        </div>
        <div class="at-cont">
          <img class="team-badge" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
          <div class="team away">${esc(away.name)}</div>
        </div>
      </header>
      <div class="match-status">
        <span class="full-time">${statusLine}</span>
        <span class="half-time">${ht}</span>
     </div>
    <div class="match-body">${eventsHtml}</div>
      <footer class="match-footer">
        <span class="footer-label">Attendance:</span>
        <span class="footer-data me-1">${attendanceText}</span>
        <span class="footer-label">Venue:</span>
        <span class="footer-data">${esc(match.venue)}</span>
      </footer>
    </div>
  `;
}

function renderEventText(evt) {
    const player = esc(evt.player ?? "");

    if (evt.type === "red") {
        return `
      <span class="player">${player}</span>
      <span class="card red" title="Red card" aria-label="Red card"></span>
    `;
    }

    // goal
    const assist = evt.assist ? `<span class="assist">(${esc(evt.assist)})</span>` : "";
    const detail = evt.detail ? `<span class="assist">(${esc(evt.detail)})</span>` : "";

    return `
    <span class="player">${player}</span>
    ${assist}
    ${detail}
  `;
}

function renderEventRow(evt) {
    const minute = esc(evt.minute);

    const homeCell = evt.team === "home" ? renderEventText(evt) : "";
    const awayCell = evt.team === "away" ? renderEventText(evt) : "";

    return `
    <div class="row">
      <div class="event home">${homeCell}</div>
      <div class="minute">${minute}</div>
      <div class="event away">${awayCell}</div>
    </div>
  `;
}

let simMinute = 0;
let simTimer = null;
let inHalfTime = false;

function tick() {
    // Advance minute
    simMinute += 1;

    // Set status (simple model)
    // Set status (realistic model)
    if (simMinute < 46) {
        liveMatch.status.state = `${simMinute}'`;
    } else if (simMinute === 46) {
        liveMatch.status.state = "HT";
        liveMatch.status.halfTimeScore = `${liveMatch.score.home}–${liveMatch.score.away}`;
        inHalfTime = true;
    } else if (inHalfTime) {
        // first tick after HT
        inHalfTime = false;
        liveMatch.status.state = "46'";
    } else if (simMinute < 91) {
        liveMatch.status.state = `${simMinute}'`;
    } else {
        liveMatch.status.state = "FT";
        stopSim();
    }

    // Occasionally add an event (tune these odds however you like)
    maybeAddEvent(simMinute);

    // Re-render
    renderDiff(liveMatch);

}

function startSim() {
    if (simTimer) return;
    simTimer = setInterval(tick, 50); // every 2.5s
}

function stopSim() {
    if (!simTimer) return;
    clearInterval(simTimer);
    simTimer = null;
}

function formatMinute(minute) {
    if (minute === 45) return "45'";
    if (minute > 45 && minute < 50) return `45'+${minute - 45}`;
    if (minute === 90) return "90'";
    if (minute > 90) return `90'+${minute - 90}`;
    return `${minute}'`;
}

function maybeAddEvent(minute) {
    // Don’t spam events
    if (liveMatch.status?.state === "HT" || liveMatch.status?.state === "FT") return;

    // 20% chance each tick (adjust)
    if (Math.random() > 0.03) return;

    const team = Math.random() > 0.5 ? "home" : "away";
    const typeRoll = Math.random();
    let evt;

    if (typeRoll < 0.92) {
        // goal 80% of the time
        evt = {
            minute: `${formatMinute(minute)}`,
            team,
            type: "goal",
            player: pickPlayer(team),
            assist: Math.random() > 0.2 ? pickPlayer(team) : undefined,
        };

        // 15% of goals are pens
        if (Math.random() < 0.05) {
            delete evt.assist;
            evt.detail = "pen";
        }

        // update score
        if (team === "home") liveMatch.score.home += 1;
        else liveMatch.score.away += 1;
    } else {
        // red card 20% of the time
        evt = {
            minute: `${minute}'`,
            team,
            type: "red",
            player: pickPlayer(team),
        };
    }

    liveMatch.events = liveMatch.events || [];

    evt.id = crypto.randomUUID();
    liveMatch.events.push(evt);

    // liveMatch.events.push(evt);
}

function pickPlayer(team) {
    const pools = {
        home: [
            "Saka",
            "Ødegaard",
            "Merino",
            "Rice",
            "Martinelli",
            "Saliba",
            "Gyökeres",
            "Eze",
            "Madueke",
            "Zubimendi",
            "Havertz",
        ],
        away: [
            "Haaland",
            "Cherki",
            "Foden",
            "Rodri",
            "Bernardo",
            "Doku",
            "Dias",
            "Gvardiol",
            "Aït-Nouri",
            "Stones",
            "Kovačić",
        ],
    };

    const list = pools[team] || ["Player"];
    return list[Math.floor(Math.random() * list.length)];
}

startSim();
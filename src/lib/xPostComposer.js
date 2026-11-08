const TEAM_X_HANDLES = {
  arsenal: "@Arsenal",
  "aston-villa": "@AVFCOfficial",
  bournemouth: "@afcbournemouth",
  brentford: "@BrentfordFC",
  brighton: "@OfficialBHAFC",
  chelsea: "@ChelseaFC",
  "coventry-city": "@Coventry_City",
  "crystal-palace": "@CPFC",
  everton: "@Everton",
  fulham: "@FulhamFC",
  "hull-city": "@HullCity",
  ipswich: "@IpswichTown",
  leeds: "@LUFC",
  liverpool: "@LFC",
  "manchester-city": "@ManCity",
  "manchester-united": "@ManUtd",
  newcastle: "@NUFC",
  "nottingham-forest": "@NFFC",
  sunderland: "@SunderlandAFC",
  tottenham: "@SpursOfficial",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function xHandlesForTeams(teamIds = []) {
  return unique(teamIds.map((teamId) => TEAM_X_HANDLES[teamId]));
}

export function matchHashtag(home, away) {
  const homeCode = String(home?.shortName || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const awayCode = String(away?.shortName || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return homeCode && awayCode ? `#${homeCode}${awayCode}` : "";
}

export function buildXPostButtonHtml({
  footer,
  handles = [],
  hashtags = [],
  heading = "Create an X post",
  label = "Post",
  url,
}) {
  return `
    <button
      type="button"
      class="x-post-compose-button"
      data-x-post-compose
      data-x-post-footer="${escapeHtml(footer)}"
      data-x-post-handles="${escapeHtml(unique(handles).join(" "))}"
      data-x-post-hashtags="${escapeHtml(unique(hashtags).join(" "))}"
      data-x-post-heading="${escapeHtml(heading)}"
      data-x-post-url="${escapeHtml(url)}"
      title="${escapeHtml(heading)}"
    ><span aria-hidden="true">X</span><span>${escapeHtml(label)}</span></button>
  `.trim();
}

function weightedLength(text) {
  const links = String(text).match(/https?:\/\/\S+/g) || [];
  const withoutLinks = String(text).replace(/https?:\/\/\S+/g, "");
  const textWeight = Array.from(withoutLinks).reduce((total, character) => {
    const codePoint = character.codePointAt(0);
    const singleWeight = codePoint <= 0x10ff
      || (codePoint >= 0x2000 && codePoint <= 0x200d)
      || (codePoint >= 0x2010 && codePoint <= 0x201f)
      || (codePoint >= 0x2032 && codePoint <= 0x2037);
    return total + (singleWeight ? 1 : 2);
  }, 0);
  return textWeight + links.length * 23;
}

function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "x-post-composer";
  dialog.innerHTML = `
    <div class="x-post-composer__header">
      <h2 data-x-post-dialog-title>Create an X post</h2>
      <button type="button" class="x-post-composer__close" data-x-post-close aria-label="Close">&times;</button>
    </div>
    <div class="x-post-composer__body">
      <label class="x-post-composer__label" for="x-post-observation">Your observation</label>
      <textarea id="x-post-observation" data-x-post-observation rows="4" maxlength="280" placeholder="Write the unique point you want to make..."></textarea>
      <div class="x-post-composer__handles" data-x-post-handles-wrap hidden>
        <span>Insert team:</span>
        <div data-x-post-handle-buttons></div>
      </div>
      <label class="x-post-composer__label" for="x-post-preview">Post preview</label>
      <textarea id="x-post-preview" data-x-post-preview rows="8" readonly></textarea>
      <div class="x-post-composer__meta">
        <label for="x-post-image">Image</label>
        <select id="x-post-image" data-x-post-image></select>
        <output data-x-post-count>0 / 280</output>
      </div>
      <p class="x-post-composer__status" data-x-post-status aria-live="polite"></p>
    </div>
    <div class="x-post-composer__actions">
      <button type="button" data-x-post-copy-download>Copy + Download</button>
      <button type="button" class="x-post-composer__primary" data-x-post-open>Open X</button>
    </div>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function downloadButtonsFor(trigger) {
  const scope = trigger.closest("[data-matchweek-team-stats], .match-page-card") || document;
  return Array.from(scope.querySelectorAll("[data-matchweek-ratings-download], [data-download-image]"));
}

function downloadLabel(button) {
  return button.textContent?.trim()
    || button.getAttribute("aria-label")
    || button.getAttribute("title")
    || "Image";
}

function writeClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  return Promise.resolve();
}

function waitForDownload(button) {
  button.click();
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (!button.disabled || Date.now() - started > 20_000) {
        window.clearInterval(timer);
        resolve();
      }
    }, 120);
  });
}

export function setupXPostComposer() {
  let dialog;
  let activeTrigger;
  let context;

  function elements() {
    return {
      count: dialog.querySelector("[data-x-post-count]"),
      image: dialog.querySelector("[data-x-post-image]"),
      observation: dialog.querySelector("[data-x-post-observation]"),
      preview: dialog.querySelector("[data-x-post-preview]"),
      status: dialog.querySelector("[data-x-post-status]"),
    };
  }

  function composeText() {
    const { observation } = elements();
    const message = observation.value.trim();
    const supporting = [
      context.footer,
      `⚽ ${context.url}`,
      context.hashtags.join(" "),
    ].filter(Boolean).join("\n");
    return [message, supporting].filter(Boolean).join("\n\n");
  }

  function refreshPreview() {
    const { count, preview } = elements();
    const text = composeText();
    const length = weightedLength(text);
    preview.value = text;
    count.value = `${length} / 280`;
    count.classList.toggle("is-over", length > 280);
  }

  function insertHandle(handle) {
    const { observation } = elements();
    const start = observation.selectionStart ?? observation.value.length;
    const end = observation.selectionEnd ?? start;
    const before = observation.value.slice(0, start);
    const after = observation.value.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    observation.value = `${before}${prefix}${handle}${suffix}${after}`;
    const cursor = before.length + prefix.length + handle.length + suffix.length;
    observation.focus();
    observation.setSelectionRange(cursor, cursor);
    refreshPreview();
  }

  function openComposer(trigger) {
    dialog ||= createDialog();
    activeTrigger = trigger;
    const handles = trigger.dataset.xPostHandles?.split(/\s+/).filter(Boolean) || [];
    const hashtags = trigger.dataset.xPostHashtags?.split(/\s+/).filter(Boolean) || [];
    const buttons = downloadButtonsFor(trigger);
    context = {
      buttons,
      footer: trigger.dataset.xPostFooter || "More details:",
      handles,
      hashtags,
      url: trigger.dataset.xPostUrl || window.location.href,
    };

    const { image, observation, status } = elements();
    dialog.querySelector("[data-x-post-dialog-title]").textContent = trigger.dataset.xPostHeading || "Create an X post";
    observation.value = "";
    status.textContent = "";
    image.replaceChildren();
    buttons.forEach((button, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = downloadLabel(button);
      image.appendChild(option);
    });
    if (buttons.length > 1) {
      const option = document.createElement("option");
      option.value = "all";
      option.textContent = "Both images";
      image.appendChild(option);
    }
    image.closest(".x-post-composer__meta").classList.toggle("has-no-image", !buttons.length);

    const handlesWrap = dialog.querySelector("[data-x-post-handles-wrap]");
    const handleButtons = dialog.querySelector("[data-x-post-handle-buttons]");
    handleButtons.replaceChildren(...handles.map((handle) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.xPostHandle = handle;
      button.textContent = handle;
      return button;
    }));
    handlesWrap.hidden = !handles.length;
    refreshPreview();
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute("open", "");
    observation.focus();
  }

  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-x-post-compose]");
    if (trigger) {
      openComposer(trigger);
      return;
    }
    if (!dialog?.open) return;

    if (event.target.closest("[data-x-post-close]")) {
      dialog.close?.();
      dialog.removeAttribute("open");
      activeTrigger?.focus();
      return;
    }

    const handle = event.target.closest("[data-x-post-handle]")?.dataset.xPostHandle;
    if (handle) {
      insertHandle(handle);
      return;
    }

    if (event.target.closest("[data-x-post-copy-download]")) {
      const { image, status } = elements();
      const text = composeText();
      if (weightedLength(text) > 280) {
        status.textContent = "Shorten the post before copying.";
        return;
      }
      await writeClipboard(text);
      const selected = image.value === "all"
        ? context.buttons
        : context.buttons[Number(image.value)] ? [context.buttons[Number(image.value)]] : [];
      for (const button of selected) await waitForDownload(button);
      status.textContent = selected.length ? "Post copied and image downloaded." : "Post copied.";
      return;
    }

    if (event.target.closest("[data-x-post-open]")) {
      const { status } = elements();
      const text = composeText();
      if (weightedLength(text) > 280) {
        status.textContent = "Shorten the post before opening X.";
        return;
      }
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    }
  });

  document.addEventListener("input", (event) => {
    if (dialog?.open && event.target.matches("[data-x-post-observation]")) refreshPreview();
  });
}

// A hidden extra: keep the mouse on a showtime for 3 seconds, or press and hold it on a touch
// screen, to see that show's live seat map, straight from the chain (GSC or TGV). Nothing is
// fetched until the 3 seconds are up. A plain tap or click still opens the booking page.

export const HOLD_MS = 3000;
const MOVE_PX = 10; // a finger that moves this far is scrolling, not holding
const CLOSE_DELAY_MS = 250; // mouse: time to travel from the showtime into the seat map

const STATE_LABEL = { free: "available", sold: "sold", blocked: "unavailable" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const clock = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });

/** The seat grid, screen at the top. */
export function seatGrid(plan) {
  const columns = Math.max(0, ...plan.rows.map((row) => row.seats.length));
  const rows = plan.rows.map((row) => {
    if (!row.seats.some(Boolean)) return el("div", { class: "seat-aisle", "aria-hidden": "true" });
    return [
      el("span", { class: "seat-row" }, row.label),
      row.seats.map((seat) =>
        seat
          ? el("span", { class: `seat ${seat.state}${seat.pair ? " pair" : ""}`, title: `${seat.number} · ${STATE_LABEL[seat.state]}` })
          : el("span", { class: "seat-gap" }),
      ),
      el("span", { class: "seat-row" }, row.label),
    ];
  });
  return el("div", { class: "seat-grid", style: `--cols: ${columns}`, role: "img", "aria-label": `${plan.free} of ${plan.total} seats available` }, rows);
}

/**
 * Watch `root` for holds on elements matching `selector`.
 * showFor(element) gives the show behind a showtime; fetchPlan(show, signal) its seat plan.
 */
export function enableSeatPreview(root, { selector, showFor, fetchPlan }) {
  let timer = null;
  let holding = null; // the showtime being held
  let origin = null; // where the finger went down
  let anchor = null; // the showtime whose seat map is open
  let mode = "mouse";
  let controller = null;
  let closeTimer = null;
  let swallowClick = false;

  const pop = el("div", { class: "seatmap", role: "dialog", "aria-label": "Live seat map", hidden: true });
  document.body.append(pop);

  function cancelHold() {
    clearTimeout(timer);
    timer = null;
    holding?.classList.remove("holding");
    holding = null;
  }

  function startHold(target, e) {
    cancelHold();
    const show = showFor(target);
    if (!show) return;
    holding = target;
    origin = { x: e.clientX, y: e.clientY };
    const type = e.pointerType;
    target.classList.add("holding"); // the outline trace (style.css)
    timer = setTimeout(() => {
      cancelHold();
      // The finger is still down: the click that follows its release must not open the booking page.
      if (type !== "mouse") swallowClick = true;
      open(target, show, type === "mouse" ? "mouse" : "touch");
    }, HOLD_MS);
  }

  function close() {
    clearTimeout(closeTimer);
    controller?.abort();
    controller = null;
    anchor = null;
    pop.hidden = true;
    pop.replaceChildren();
  }

  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_DELAY_MS);
  };

  /** Next to the showtime with a mouse; a bottom sheet on touch screens. */
  function place() {
    pop.classList.toggle("as-sheet", mode === "touch");
    if (mode === "touch" || !anchor) {
      pop.style.left = pop.style.top = "";
      return;
    }
    const box = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
    const below = box.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, box.top - height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function open(target, show, how) {
    close();
    anchor = target;
    mode = how;
    pop.dataset.chain = show.chain;
    controller = new AbortController();
    const { signal } = controller;
    const head = el(
      "div",
      { class: "seatmap-head" },
      el("b", {}, show.start.slice(11, 16)),
      el("span", {}, [show.hall, show.experience].filter(Boolean).join(" · ")),
      el("button", { type: "button", class: "seatmap-close", "aria-label": "Close seat map", onclick: close }, "✕"),
    );
    const sub = el("div", { class: "seatmap-sub mono" }, show.cinema_name);
    const body = el("div", { class: "seatmap-body" }, el("p", { class: "seatmap-note mono" }, "Loading live seats…"));
    pop.replaceChildren(head, sub, body);
    pop.hidden = false;
    place();
    fetchPlan(show, signal).then(
      (plan) => {
        if (signal.aborted) return;
        sub.textContent = `${show.cinema_name} · ${plan.free} of ${plan.total} seats left`;
        body.replaceChildren(
          el("div", { class: "seat-screen" }, "Screen"),
          seatGrid(plan),
          el(
            "div",
            { class: "seat-legend mono" },
            el("span", {}, el("i", { class: "seat free" }), "Available"),
            el("span", {}, el("i", { class: "seat sold" }), "Sold"),
            el("span", {}, el("i", { class: "seat blocked" }), "Unavailable"),
            el("span", { class: "seat-when" }, `Live from ${show.chain} · ${clock()}`),
          ),
        );
        place();
      },
      (err) => {
        if (signal.aborted) return;
        body.replaceChildren(el("p", { class: "seatmap-note mono" }, `Couldn't load seats: ${err.message || err}`));
        place();
      },
    );
  }

  const showtimeAt = (node) => {
    const target = node instanceof Element ? node.closest(selector) : null;
    return target && root.contains(target) ? target : null;
  };

  // Mouse: resting on a showtime starts the clock; leaving it stops the clock or closes the map.
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const target = showtimeAt(e.target);
    if (target && target === anchor) clearTimeout(closeTimer);
    else if (target && target !== holding) startHold(target, e);
  });
  root.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const target = showtimeAt(e.target);
    if (!target || target.contains(e.relatedTarget)) return;
    if (target === holding) cancelHold();
    if (target === anchor && mode === "mouse" && !pop.contains(e.relatedTarget)) closeSoon();
  });
  pop.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  pop.addEventListener("pointerleave", (e) => {
    if (mode === "mouse" && !(anchor && anchor.contains(e.relatedTarget))) closeSoon();
  });

  // Touch and pen: press and hold without moving. A link's own long-press menu (open in new tab,
  // preview, copy) appears long before 3 s, and some phones won't let a page cancel it, so while a
  // finger is down the showtime isn't a link. It is again by the time a quick tap's click arrives.
  let pressed = null;
  const unlink = (target) => {
    pressed = target;
    if (!target.hasAttribute("href")) return;
    target.dataset.href = target.getAttribute("href");
    target.removeAttribute("href");
  };
  const relink = () => {
    if (pressed?.dataset.href) {
      pressed.setAttribute("href", pressed.dataset.href);
      delete pressed.dataset.href;
    }
    pressed = null;
  };
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const target = showtimeAt(e.target);
    if (!target) return;
    relink();
    unlink(target);
    startHold(target, e);
  });
  root.addEventListener("pointermove", (e) => {
    if (!holding || e.pointerType === "mouse") return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_PX) cancelHold();
  });
  for (const type of ["pointerup", "pointercancel"]) {
    root.addEventListener(type, (e) => {
      if (e.pointerType === "mouse") return;
      cancelHold();
      relink();
    });
  }
  // Belt and braces: no long-press menu while a finger is on a showtime.
  root.addEventListener("contextmenu", (e) => {
    if (holding || pressed || swallowClick) e.preventDefault();
  });
  root.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // A touch that starts somewhere else is the next thing the visitor does: forget the swallow.
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !(mode === "mouse" && anchor?.contains(e.target))) close();
    if (e.pointerType !== "mouse" && !showtimeAt(e.target)) swallowClick = false;
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || pop.hidden) return;
      e.stopPropagation(); // close the seat map only, not the movie view behind it
      close();
    },
    true,
  );
  // Scrolling moves the showtime away from a map placed next to it.
  window.addEventListener(
    "scroll",
    (e) => {
      if (!pop.hidden && mode === "mouse" && !pop.contains(e.target)) close();
    },
    true,
  );
  window.addEventListener("resize", () => !pop.hidden && place());

  return { close };
}

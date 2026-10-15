import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createProviders, parseGscPrices, parseTgvPrices, parseGscSeatPlan, parseTgvSeatPlan } from "../../site/js/providers.js";
import { seatPriceEntries } from "../../site/js/seatmap.js";
import { parseXml } from "../../scripts/xml.mjs";

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8").replace(/^\uFEFF/, "");
const json = (name) => JSON.parse(fixture(name));

test("TGV prices are tax-inclusive, grouped by area, with child and complimentary tickets skipped", () => {
  const prices = parseTgvPrices(json("tgv_tickets.json"));
  assert.deepEqual(prices.map((p) => [p.category, p.amount, p.seatsTaken]), [["single", 25, 1], ["twin", 40, 2], ["single", 12, 1]]);
  assert.deepEqual(parseTgvPrices({ success: false }), []);
  assert.deepEqual(parseTgvPrices({ success: true }), []);
});

test("GSC prices keep concessions and pair units, skip hidden tickets, and never add tax", () => {
  const prices = parseGscPrices(fixture("gsc_tickets.xml"), parseXml);
  assert.deepEqual(prices.map((p) => [p.label, p.category, p.amount, p.seatsTaken]), [["Adult", "1", 26.5, 1], ["Senior", "1", 12, 1], ["OKU", "1", 12, 1], ["Adult", "2", 40, 2]]);
  assert.deepEqual(parseGscPrices('<price><ticketdata code="-1" msg="Unavailable"/></price>', parseXml), []);
});

test("legend prices match actual seat categories, deduplicate, and label concessions and pairs", () => {
  const plan = { rows: [{ seats: [{category:"1", categoryName:"Normal"}, {category:"2", categoryName:"Twin", pair:true}] }] };
  const prices = parseGscPrices(fixture("gsc_tickets.xml"), parseXml);
  assert.deepEqual(seatPriceEntries(plan, [...prices, ...prices, {category:"other",label:"Adult",amount:99}]).map((e) => e.text), ["Normal · RM 26.50", "Normal (Senior) · RM 12.00", "Normal (OKU) · RM 12.00", "Twin · RM 40.00 (pair)"]);
  assert.deepEqual(seatPriceEntries(plan, []), []);
  const gsc = parseGscSeatPlan(fixture("gsc_seats_120_hall5.xml"), parseXml);
  assert.ok(seatPriceEntries(gsc, prices).some((e) => e.text === "Normal · RM 26.50"));
  const tgv = parseTgvSeatPlan(json("tgv_seatplan_BU0_indulge.json"));
  assert.ok(tgv.rows.flatMap((r) => r.seats).filter(Boolean).every((s) => s.category));
});

const show = {cinema_id:"BR0",business_date:"2026-10-17",start:"2026-10-17T20:00",hall:"Cinema 1",experience:"2D"};
const sessions = {results:{businessday:{cinemas:[{movies:[{experiences:[{sessions:[{sessionid:123,showtimemy:show.start,screenname:show.hall,experience:"2D",extdata:{areacategorycodes:["single","twin","single"]}}]}]}]}]}}};

test("TGV starts seats and each area's prices together, shares lookup, and keeps successful areas", async () => {
  const calls = [];
  let finishSeats;
  const providers = createProviders({fetch:async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({url,body});
    if (url.endsWith("moviesession_get")) return {ok:true,json:async()=>sessions};
    if (url.endsWith("getseatplan")) return new Promise((resolve) => { finishSeats = () => resolve({ok:true,json:async()=>json("tgv_seatplan_BU0_indulge.json")}); });
    if (body.areacategorycodes === "twin") throw new Error("price service unavailable");
    return {ok:true,json:async()=>({success:true,results:{tickets:json("tgv_tickets.json").results.tickets.filter((t) => t.areaCategoryCode === body.areacategorycodes)}})};
  }});
  const seats = providers.TGV.fetchSeatPlan(show);
  const prices = await providers.TGV.fetchSeatPrices(show);
  assert.equal(prices.length, 2);
  assert.ok(prices.every((p) => p.category === "single"));
  assert.equal(calls.filter((c) => c.url.endsWith("moviesession_get")).length, 1);
  assert.deepEqual(calls.filter((c) => c.url.endsWith("gettickets")).map((c) => c.body), ["single","twin"].map((code) => ({cinemaid:"BR0",sessionid:"123",areacategorycodes:code,req:{}})));
  finishSeats();
  assert.equal((await seats).total, 32);
});

test("GSC uses the child film and calendar date for prices; failed prices leave seats usable", async () => {
  const calls = [];
  const providers = createProviders({parseXml,fetch:async (url) => {
    calls.push(url);
    if (url.includes("Pricing")) throw new Error("price service unavailable");
    return {ok:true,text:async()=>fixture(url.includes("SeatStatus") ? "gsc_seats_120_hall5.xml" : "gsc_showtimes_120.xml")};
  }});
  const late = {cinema_id:"120",business_date:"2026-10-15",start:"2026-10-16T00:15",hall:"Hall 5"};
  const [seats, prices] = await Promise.allSettled([providers.GSC.fetchSeatPlan(late),providers.GSC.fetchSeatPrices(late)]);
  assert.equal(seats.value.free, 108);
  assert.equal(prices.status, "rejected");
  assert.equal(calls.length, 3);
  const url = new URL(calls.find((c) => c.includes("Pricing")));
  assert.equal(url.searchParams.get("filmid"), "1000005590");
  assert.equal(url.searchParams.get("hallid"), "5");
  assert.equal(url.searchParams.get("showdate"), "2026-10-16");
});

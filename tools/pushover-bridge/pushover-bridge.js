#!/usr/bin/env node
/**
 * pushover-bridge.js — campanello "nuovo prospect" per il CRM intake.
 *
 * Il CRM (azione automation call_webhook) POSTa JSON {event, occurred_at, data:{lead, contact}}.
 * Questo bridge traduce in form-urlencoded e chiama Pushover (api.pushover.net).
 *
 * Config (env): PUSHOVER_TOKEN, PUSHOVER_USER, PORT (default 8799).
 * Le chiavi NON stanno nel repo: file .env nella cartella del bridge sul VPS
 * (chmod 600), oppure environment del service manager. Mai in chat.
 */
const http = require("http");
const https = require("https");
const { URLSearchParams } = require("url");

const TOKEN = process.env.PUSHOVER_TOKEN;
const USER = process.env.PUSHOVER_USER;
const PORT = process.env.PORT || 8799;
if (!TOKEN || !USER) {
  console.error("Servono PUSHOVER_TOKEN e PUSHOVER_USER nell'ambiente. Esco.");
  process.exit(1);
}

function pushover(title, message, cb) {
  const body = new URLSearchParams({ token: TOKEN, user: USER, title, message }).toString();
  const req = https.request(
    { hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
    (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => cb(res.statusCode, b)); }
  );
  req.on("error", (e) => cb(0, String(e)));
  req.end(body);
}

// campi liberi del widget (webhook_lead_captures.fields) arrivano nel lead.custom_fields
function resumenBreve(lead) {
  const f = (lead && lead.custom_fields) || {};
  const pick = (k) => (typeof f[k] === "string" && f[k].trim() ? f[k].trim() : null);
  return [
    pick("sector") && `Settore: ${pick("sector")}`,
    pick("vende") && `Vende: ${pick("vende")}`,
    pick("respWa") && `WA: ${pick("respWa")}`,
  ].filter(Boolean).join(" · ");
}

http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    try {
      const j = JSON.parse(b || "{}");
      if (j.event !== "lead.created") { res.writeHead(200).end('{"skipped":1}'); return; }
      const lead = j.data && j.data.lead ? j.data.lead : {};
      const contact = j.data && j.data.contact ? j.data.contact : {};
      const nome = contact.display_name || contact.name || lead.title || "Nuevo prospect";
      const dettagli = resumenBreve(lead) || "—";
      const msg = `${nome}\n${dettagli}\nFuente: ${lead.source || "webhook"}`;
      pushover("Nuevo prospect — widget All-io", msg, (status, resp) => {
        console.log(new Date().toISOString(), "pushover:", status, resp.slice(0, 120));
        res.writeHead(status >= 200 && status < 300 ? 200 : 502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
      });
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ ok: false, error: String(e) }));
    }
  });
}).listen(PORT, () => console.log(`pushover-bridge in ascolto su :${PORT}`));
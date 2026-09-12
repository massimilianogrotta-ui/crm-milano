#!/usr/bin/env node
/**
 * telegram-bridge.js — campanello "nuevo prospect" per il CRM intake.
 *
 * Il CRM (azione automation call_webhook) POSTa JSON {event, occurred_at, data:{lead, contact}}.
 * Questo bridge traduce e chiama l'API Bot di Telegram (api.telegram.org, gratuita).
 *
 * Config (env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PORT (default 8799).
 * Il bot token NON sta nel repo: file .env nella cartella del bridge sul VPS
 * (chmod 600) o environment del service manager. Mai in chat.
 *
 * Setup bot (5 min, si fa una volta):
 *   1. Telegram → @BotFather → /newbot → nome → ricevi il token (formato 123456:ABC-...).
 *   2. Scrivi un messaggio qualsiasi al nuovo bot (necessario per sbloccare la chat).
 *   3. Chat ID: apri https://api.telegram.org/bot<TOKEN>/getUpdates → cerca "chat":{"id":123456789}.
 */
const http = require("http");
const https = require("https");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 8799;
if (!TOKEN || !CHAT) {
  console.error("Servono TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nell'ambiente. Esco.");
  process.exit(1);
}

function telegram(text, cb) {
  const body = JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true });
  const req = https.request(
    { hostname: "api.telegram.org", path: `/bot${TOKEN}/sendMessage`, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => cb(res.statusCode, b)); }
  );
  req.on("error", (e) => cb(0, String(e)));
  req.end(body);
}

// campi liberi del widget (webhook_lead_captures.fields) arrivano in lead.custom_fields
function resumenBreve(lead) {
  const f = (lead && lead.custom_fields) || {};
  const pick = (k) => (typeof f[k] === "string" && f[k].trim() ? f[k].trim() : null);
  return [
    pick("sector") && `Sector: ${pick("sector")}`,
    pick("vende") && `Vende: ${pick("vende")}`,
    pick("respWa") && `WA: ${pick("respWa")}`,
  ].filter(Boolean).join("\n");
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
      const msg = `🟢 Nuevo prospect — widget All-io\n\n👤 ${nome}\n${dettagli ? dettagli + "\n" : ""}Fuente: ${lead.source || "webhook"}\n${new Date().toLocaleString("it-IT")}`;
      telegram(msg, (status, resp) => {
        console.log(new Date().toISOString(), "telegram:", status, resp.slice(0, 120));
        res.writeHead(status >= 200 && status < 300 ? 200 : 502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
      });
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ ok: false, error: String(e) }));
    }
  });
}).listen(PORT, () => console.log(`telegram-bridge in ascolto su :${PORT}`));
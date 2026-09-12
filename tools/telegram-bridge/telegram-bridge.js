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
 *
 * v2 (2026-09-12): paese d'origine (lookup ip-api.com sul remote_ip del CRM,
 * passato nel payload di ingresso come campo opzionale `remote_ip`) + azione
 * suggerita inline (inline keyboard) con link diretto alla scheda lead.
 */
const http = require("http");
const https = require("https");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 8799;
// Base dell'istanza CRM per il link alla scheda (es. https://crm.all-io.com)
const CRM_BASE = process.env.CRM_BASE || "";
if (!TOKEN || !CHAT) {
  console.error("Servono TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nell'ambiente. Esco.");
  process.exit(1);
}

function httpsPost(host, path, body, cb) {
  const req = https.request(
    { hostname: host, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => cb(res.statusCode, b)); }
  );
  req.on("error", (e) => cb(0, String(e)));
  req.end(body);
}

function telegram(text, buttons, cb) {
  const payload = { chat_id: CHAT, text, disable_web_page_preview: true };
  if (buttons && buttons.length) payload.reply_markup = { inline_keyboard: buttons };
  httpsPost("api.telegram.org", `/bot${TOKEN}/sendMessage`, JSON.stringify(payload), cb);
}

// IP privati/loopback → null (nessun lookup). Pubblico → ip-api.com (gratuito, 60/min).
function paeseDaIp(ip, cb) {
  if (!ip) return cb(null);
  const clean = String(ip).replace(/^::ffff:/, "").trim();
  if (!clean || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fe80:)/.test(clean)) return cb(null);
  const req = https.get(`https://ip-api.com/json/${encodeURIComponent(clean)}?fields=country,countryCode`, (res) => {
    let b = ""; res.on("data", (c) => (b += c));
    res.on("end", () => {
      try { const j = JSON.parse(b); cb(j.status === "success" ? { nome: j.country, iso: j.countryCode } : null); }
      catch { cb(null); }
    });
  });
  req.on("error", () => cb(null));
  req.setTimeout(4000, () => { req.destroy(); cb(null); });
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

/** Azione suggerita in base alle risposte del widget (regole semplici, spiegabili). */
function azioneSuggerita(lead) {
  const f = (lead && lead.custom_fields) || {};
  const pick = (k) => (typeof f[k] === "string" && f[k].trim() ? f[k].trim() : "");
  const links = [];
  if (CRM_BASE && lead.id) links.push([{ text: "📋 Apri la scheda", url: `${CRM_BASE}/leads/${lead.id}` }]);
  const wa = pick("respWa").replace(/[^\d+]/g, "");
  const nome = (contact => contact)((lead.custom_fields && pick("respNome")) || lead.title || "");
  const testo = pick("respWa")
    ? `https://wa.me/${wa}?text=${encodeURIComponent("Hola! Soy All-io, te contacto por la configuración de tu CRM.")}`
    : null;
  const azioni = [];
  if (testo) azioni.push([{ text: "💬 Escribirle por WhatsApp", url: testo }]);
  if (links.length) azioni.push(...links);
  if (!azioni.length) return { nota: "", buttons: [] };
  return { nota: "\n\n👇 Acción sugerida:", buttons: azioni.slice(0, 2) };
}

http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    let j;
    try { j = JSON.parse(b || "{}"); }
    catch { res.writeHead(400).end(JSON.stringify({ ok: false, error: "bad_json" })); return; }
    if (j.event !== "lead.created") { res.writeHead(200).end('{"skipped":1}'); return; }
    const lead = j.data && j.data.lead ? j.data.lead : {};
    const contact = j.data && j.data.contact ? j.data.contact : {};
    const nome = contact.display_name || contact.name || lead.title || "Nuevo prospect";
    paeseDaIp(j.remote_ip || (j.data && j.data.remote_ip), (paese) => {
      const righe = [`🟢 Nuevo prospect — widget All-io`, ``, `👤 ${nome}`];
      const det = resumenBreve(lead);
      if (det) righe.push(det);
      if (paese) righe.push(`🌍 País: ${paese.nome} (${paese.iso})`);
      righe.push(`Fuente: ${lead.source || "webhook"}`);
      righe.push(new Date().toLocaleString("it-IT"));
      const sug = azioneSuggerita(lead);
      if (sug.nota) righe.push(sug.nota);
      telegram(righe.join("\n"), sug.buttons, (status, resp) => {
        console.log(new Date().toISOString(), "telegram:", status, resp.slice(0, 120));
        res.writeHead(status >= 200 && status < 300 ? 200 : 502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
      });
    });
  });
}).listen(PORT, () => console.log(`telegram-bridge in ascolto su :${PORT}`));
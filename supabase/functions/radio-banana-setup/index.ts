// RB-006 — funzione disattivata (incidente forense RB-000/RB-006).
//
// La versione precedente creava tabelle pubbliche (productores/exportadores/
// precios) con nome, telefono e foto reali, leggibili da chiunque tramite
// `FOR SELECT TO anon USING (true)` — esattamente il contrario di quanto
// RB-003 imponeva. Aveva anche un'azione `publish_agent` che permetteva a
// chiunque di pubblicare qualunque versione di un agente IA per qualunque
// organizzazione, senza nessun controllo di appartenenza. Non apparteneva
// all'architettura prevista.
//
// Non è stato possibile CANCELLARE la funzione dall'elenco tramite gli
// strumenti disponibili (solo deploy/lettura, non delete) — questa versione
// la neutralizza: nessun uso della service role key, nessuna esecuzione SQL,
// nessuna creazione di tabella. Risponde sempre 410 Gone. Verificato in
// produzione (crm-radiobanana) il 2026-09-15.
//
// Rimozione completa dall'elenco funzioni: da fare a mano dal pannello
// Supabase (Edge Functions > radio-banana-setup > Delete).

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts';

serve(async (_req) => {
  return new Response(
    JSON.stringify({
      error: 'gone',
      message: 'Questa funzione è stata disattivata (incidente RB-006, 2026-09-15). Non crea più nulla.',
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  );
});

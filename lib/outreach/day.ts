/** Confini UTC della giornata civile Europe/Rome, compreso il cambio d'ora. */
export function giornataRoma(ora: Date): { inizio: string; fine: string } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(f.formatToParts(ora).map((p) => [p.type, p.value]));
  const giorno = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const offset = (utc: number) => {
    const name = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" })
      .formatToParts(new Date(utc)).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    return (match?.[1] === "-" ? -1 : 1) * (Number(match?.[2] ?? 1) * 60 + Number(match?.[3] ?? 0)) * 60_000;
  };
  const mezzanotte = (utc: number) => new Date(utc - offset(utc)).toISOString();
  return { inizio: mezzanotte(giorno), fine: mezzanotte(giorno + 86_400_000) };
}

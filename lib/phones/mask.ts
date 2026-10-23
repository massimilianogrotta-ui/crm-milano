/**
 * Telefone em log: código do país, o meio oculto, os três últimos dígitos.
 *
 * O comentário do logger já proibia telefone completo. Isto é a forma, para
 * quem precisa correlacionar um evento sem gravar o número. Não é anonimização
 * de LGPD — é só o que pode aparecer num log.
 */

export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return "***";

  const cc = digits.startsWith("593")
    ? "593"
    : digits.startsWith("55")
      ? "55"
      : digits.slice(0, Math.min(2, digits.length - 3));
  const last3 = digits.slice(-3);
  const hidden = Math.max(4, digits.length - cc.length - 3);
  const plus = trimmed.startsWith("+") || digits.length >= 10 ? "+" : "";
  return `${plus}${cc}${"*".repeat(hidden)}${last3}`;
}

/** Troca sequências de 10 a 15 dígitos (com ou sem +) pela máscara. */
export function redactPhones(text: string): string {
  return text.replace(/\+?\d{10,15}/g, (trecho) => maskPhone(trecho));
}

/** Tira bearer e access_token de uma mensagem de erro antes de logar ou devolver. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
}

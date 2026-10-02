const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h\d)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, code: string) => {
      if (ENTITIES[code] !== undefined) return ENTITIES[code];
      if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return match;
    })
    .replace(/\u200b/g, "");
}

/** Markers where an email reply's quoted history begins. */
const QUOTE_MARKERS: RegExp[] = [
  /^-{3,}\s*Original Message\s*-{3,}/im,
  /^_{10,}\s*$/m,
  /^\*?From:\*?\s.*\r?\n\s*\*?(Sent|Date):\*?\s/im,
  /^On [^\n]{5,300}?(\r?\n[^\n]{0,200})?wrote:\s*$/im,
  /^\*?De\s?:\*?\s.*\r?\n\s*\*?(Envoy[ée]|Date|Enviado|Fecha)\s?:\*?\s/im,
  /^\*?Von:\*?\s.*\r?\n\s*\*?(Gesendet|Datum):\*?\s/im,
  /^Le [^\n]{5,300}?a écrit\s?:\s*$/im,
  /^El [^\n]{5,300}?(\r?\n[^\n]{0,200})?escribió:\s*$/im,
  /^Em [^\n]{5,300}?escreveu:\s*$/im,
  /^Am [^\n]{5,300}?schrieb[^\n]*:\s*$/im,
];

/** Keeps only the newly written part of an email reply. */
export function stripQuotedReply(body: string): string {
  let cut = body.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && match.index < cut) cut = match.index;
  }
  return body
    .slice(0, cut)
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

/** Lines added by the BMC case email template and common mail gateways. */
const BOILERPLATE_LINES: RegExp[] = [
  /^Case Subject:/i,
  /^TIP: If you want to get more out of our knowledge database/i,
  /^https:\/\/bmcapps\.my\.site\.com\/casemgmt\/sc_KnowledgeArticle\?sfdcid=000434074/i,
  /^Search the Knowledge Base, find Documentation/i,
  /^When replying, please leave the \[ ref:/i,
  /^\[?\s*ref:!?[\w.!]+:ref\s*\]?$/i,
  /^CAUTION: This email originated from outside/i,
  /^Beware of suspicious links/i,
  /^P \{margin-top:0;margin-bottom:0;\}$/i,
];
/** Where a signature's legal disclaimer starts; everything after it is dropped. */
const DISCLAIMER = /^(Confidentiality Notice|CONFIDENTIAL(ITY)?( NOTICE)?:|This (e-?mail|message)( and any (attachments|files))? (is|may contain|are) (intended|confidential|privileged))/im;

export function stripEmailBoilerplate(text: string): string {
  const disclaimer = DISCLAIMER.exec(text);
  const body = disclaimer ? text.slice(0, disclaimer.index) : text;
  return body
    .split(/\r?\n/)
    .filter((line) => !BOILERPLATE_LINES.some((re) => re.test(line.trim())))
    .join("\n");
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()} …[truncated]`;
}

const AUTO_REPLY_SUBJECT = /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|réponse automatique|abwesenheitsnotiz|respuesta automática)/i;

export function isAutoReply(subject: string | null): boolean {
  return AUTO_REPLY_SUBJECT.test(subject?.trim() ?? "");
}

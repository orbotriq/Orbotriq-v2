// Quote every cell; neutralize formula prefixes even after leading whitespace/control characters.
export function csvCell(value: string): string {
  const clean = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g," ");
  const dangerous = /^[\s\uFEFF]*[=+@\-＝＋＠－]/u.test(clean) || /^[\t\r\n]/.test(clean);
  return '"' + (dangerous ? "'" : "") + clean.replace(/"/g,'""') + '"';
}
export function leadCsv(rows: readonly (readonly string[])[]): string {
  return "\uFEFF" + rows.map(row=>row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

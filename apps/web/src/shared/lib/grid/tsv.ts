/** Parses clipboard text the way spreadsheets write it: tab-separated, newline-separated, "quoted" cells. */
export const parseTsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      i++;
    } else if (ch === '\t') {
      pushCell();
      i++;
    } else if (ch === '\r') {
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      pushRow();
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  // A trailing newline (every spreadsheet adds one) does not make an extra empty row.
  if (cell !== '' || row.length > 0 || quoted) pushRow();
  return rows;
};

const needsQuotes = (s: string) => /[\t\r\n"]/.test(s);

export const serializeTsv = (rows: readonly (readonly string[])[]): string =>
  rows
    .map((r) => r.map((c) => (needsQuotes(c) ? `"${c.replaceAll('"', '""')}"` : c)).join('\t'))
    .join('\n');

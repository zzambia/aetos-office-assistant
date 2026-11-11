import { SafeError, suggestionLimit, LIMIT } from './core.js?v=0.2.10';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function safeLink(href) { try { const u = new URL(href); return ['https:', 'http:', 'mailto:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
export function markdownToOoxml(markdown, { leadingBoundary = false, trailingBoundary = false } = {}) {
  suggestionLimit(markdown);
  if (!markdown.trim()) throw new SafeError('The suggestion is empty.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(markdown)) throw new SafeError('Suggestion contains unsupported control characters.');
  let count = 0; const relationships = [], lists = [];
  function run(text, props = '') { return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${text.split('\n').map((x, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(x)}</w:t>`).join('')}</w:r>`; }
  function inline(s, props = '', depth = 0) {
    if (depth > 24) throw new SafeError('Markdown nesting is too deep.');
    let out = '', plain = '';
    const flush = () => { if (plain) { out += run(plain, props); plain = ''; } };
    for (let i = 0; i < s.length;) {
      if (s[i] === '\\' && i + 1 < s.length) { plain += s[i + 1]; i += 2; continue; }
      if (s[i] === '`') {
        const marks = /^`+/.exec(s.slice(i))[0], end = s.indexOf(marks, i + marks.length);
        if (end >= 0) { flush(); out += run(s.slice(i + marks.length, end), props + '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F1F3F5"/>'); i = end + marks.length; continue; }
      }
      const link = /^\[([^\]\n]+)\]\(([^\s)]+)\)/.exec(s.slice(i));
      if (link) {
        flush(); const href = safeLink(link[2]);
        if (href) { const id = `link${relationships.length + 1}`; relationships.push({ id, href }); out += `<w:hyperlink r:id="${id}">${inline(link[1], props + '<w:color w:val="235DA8"/><w:u w:val="single"/>', depth + 1)}</w:hyperlink>`; }
        else out += run(link[1], props);
        i += link[0].length; continue;
      }
      let matched = false;
      for (const [mark, property] of [['**', '<w:b/>'], ['__', '<w:b/>'], ['~~', '<w:strike/>'], ['*', '<w:i/>'], ['_', '<w:i/>']]) {
        if (!s.startsWith(mark, i)) continue;
        const end = s.indexOf(mark, i + mark.length);
        if (end > i + mark.length) { flush(); out += inline(s.slice(i + mark.length, end), props + property, depth + 1); i = end + mark.length; matched = true; break; }
      }
      if (!matched) { plain += s[i]; i++; }
    }
    flush(); return out;
  }
  const paragraph = (content = '', props = '') => { if (++count > LIMIT.paragraphs) throw new SafeError('Rendered result exceeds 4,096 paragraphs.'); return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${props}</w:pPr>${content}</w:p>`; };
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const isList = line => /^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(v => v.trim().replace(/\\\|/g, '|'));
  const tableDivider = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  let body = leadingBoundary ? paragraph() : '', listStack = [], fence = null, code = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        body += paragraph(run(code.join('\n'), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>'), '<w:shd w:fill="F1F3F5"/>'); fence = null; code = [];
      } else code.push(line);
      continue;
    }
    if (marker) { fence = marker[1]; listStack = []; continue; }
    if (!line.trim()) { listStack = []; continue; }
    if (i + 1 < lines.length && line.includes('|') && tableDivider(lines[i + 1])) {
      const rows = [cells(line)]; i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]));
      const columns = rows[0].length;
      if (rows.some(r => r.length !== columns) || columns > 63) throw new SafeError('Markdown table has inconsistent or too many columns.');
      body += `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:color="CCD2DB"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>${rows.map((r, n) => `<w:tr>${n === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map(c => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(inline(c, n === 0 ? '<w:b/>' : ''))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
      listStack = []; continue;
    }
    const heading = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line), list = isList(line);
    if (heading) { const level = heading[1].length; body += paragraph(inline(heading[2], `<w:b/><w:sz w:val="${38 - level * 2}"/>`), `<w:outlineLvl w:val="${level - 1}"/><w:keepNext/><w:spacing w:before="200" w:after="100"/>`); listStack = []; }
    else if (list) {
      const indent = list[1].replace(/\t/g, '    ').length, ordered = /^\d/.test(list[2]);
      while (listStack.length && listStack.at(-1).indent > indent) listStack.pop();
      if (listStack.at(-1)?.indent !== indent || listStack.at(-1)?.ordered !== ordered) {
        if (listStack.at(-1)?.indent === indent) listStack.pop();
        const item = { indent, ordered, id: lists.length + 1, start: ordered ? Number.parseInt(list[2]) : 1 }; lists.push(item); listStack.push(item);
      }
      if (listStack.length > 9) throw new SafeError('Lists support at most nine nesting levels.');
      const level = listStack.length - 1, id = listStack.at(-1).id;
      body += paragraph(inline(list[3]), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>`);
    } else {
      const block = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(\s{0,3}#{1,6}\s|\s{0,3}`{3,}|\s{0,3}~{3,})/.test(lines[i + 1]) && !isList(lines[i + 1]) && !(i + 2 < lines.length && tableDivider(lines[i + 2]))) block.push(lines[++i]);
      body += paragraph(inline(block.join('\n'))); listStack = [];
    }
  }
  if (fence) body += paragraph(run(code.join('\n'), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'));
  if (trailingBoundary || body.endsWith('</w:tbl>')) body += paragraph();
  const numbering = lists.map(l => `<w:abstractNum w:abstractNumId="${l.id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="${Math.min(l.start, 2147483647)}"/><w:numFmt w:val="${l.ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${l.ordered ? `%${level + 1}.` : '•'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`).join('') + lists.map(l => `<w:num w:numId="${l.id}"><w:abstractNumId w:val="${l.id}"/></w:num>`).join('');
  const part = (name, type, xml) => `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">${part('/_rels/.rels', 'application/vnd.openxmlformats-package.relationships+xml', `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OR}/officeDocument" Target="word/document.xml"/></Relationships>`)}${part('/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', `<w:document xmlns:w="${W}" xmlns:r="${OR}"><w:body>${body}</w:body></w:document>`)}${part('/word/_rels/document.xml.rels', 'application/vnd.openxmlformats-package.relationships+xml', `<Relationships xmlns="${REL}"><Relationship Id="numbering" Type="${OR}/numbering" Target="numbering.xml"/>${relationships.map(r => `<Relationship Id="${r.id}" Type="${OR}/hyperlink" Target="${esc(r.href)}" TargetMode="External"/>`).join('')}</Relationships>`)}${part('/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml', `<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`)}</pkg:package>`;
}

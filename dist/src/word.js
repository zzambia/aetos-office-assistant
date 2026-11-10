/* global Office, Word */
import { assertFresh, validateSelection, SafeError } from './core.js?v=0.2.9';
import { fingerprint, changedArea, changeDetails } from './fingerprint.js?v=0.2.9';
import { markdownToOoxml } from './markdown.js?v=0.2.9';
import { VERSION } from './version.js?v=0.2.9';
const readFailure = () => new SafeError('Word could not verify the document. Save it as DOCX, check host support and try again.');
function officeCall(invoke) { return new Promise((resolve, reject) => invoke(r => r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(readFailure()))); }
async function digestDocument(diagnosticParts = null) {
  const file = await officeCall(cb => Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 65536 }, cb));
  try {
    if (file.size > 64 * 1024 * 1024) throw new SafeError('Document exceeds the 64 MiB local integrity-check limit.');
    const bytes = new Uint8Array(file.size); let offset = 0;
    for (let i = 0; i < file.sliceCount; i++) { const slice = await officeCall(cb => file.getSliceAsync(i, cb)); bytes.set(slice.data, offset); offset += slice.data.length; }
    return await fingerprint(bytes, diagnosticParts);
  } finally { await officeCall(cb => file.closeAsync(cb)); }
}
export class WordHost {
  constructor() { this.identity = crypto.randomUUID(); this.document = Office.context.document; this.url = this.document.url; this.busy = false; }
  checkIdentity() { if (Office.context.document !== this.document || Office.context.document.url !== this.url) throw new SafeError('The document identity changed. Reopen the assistant and generate again.'); return this.identity; }
  async prepare() {
    this.checkIdentity(); const beforeParts = new Map(), afterParts = new Map(); const before = await digestDocument(beforeParts); let snapshot;
    try {
      await Word.run(async ctx => {
        const range = ctx.document.getSelection(); range.load('text,isEmpty'); range.paragraphs.load('items');
        const xml = range.getOoxml(), cell = range.parentTableCellOrNullObject; cell.load('isNullObject');
        const body = range.parentBody; body.load('type'); await ctx.sync();
        if (!['MainDoc', 'TableCell', 'Header', 'Footer'].includes(body.type)) throw new SafeError('Select ordinary text in the body, one table cell, a header or a footer.');
        let wholeCell = false;
        if (!cell.isNullObject) { const comparison = range.compareLocationWith(cell.body.getRange('Whole')); await ctx.sync(); wholeCell = !range.isEmpty && comparison.value === 'Contains'; }
        validateSelection({ text: range.text, xml: xml.value, paragraphs: range.paragraphs.items.length, inCell: !cell.isNullObject, wholeCell });
        range.track(); await ctx.sync();
        snapshot = { range, source: range.text, identity: this.identity, digest: before, invalid: false };
      });
      const after = await digestDocument(afterParts);
      if (before !== after) {
        // Generation is read-only. Allow a preview only if its selected source
        // still matches, but never allow automatic application of an uncertain snapshot.
        await Word.run(snapshot.range, async ctx => {
          const current = ctx.document.getSelection(); current.load('text');
          const relation = current.compareLocationWith(snapshot.range); await ctx.sync();
          assertFresh(snapshot, { identity: this.identity, digest: before, source: current.text, relation: relation.value });
        });
        snapshot.invalid = true;
        snapshot.diagnostic = `AETOS Office Assistant ${VERSION}\nPreparation: ${changedArea(before, after)}\n${changeDetails(before, after, beforeParts, afterParts)}`;
        snapshot.notice = 'Word’s document check is unstable. You can review and copy this suggestion; automatic insertion is disabled. Please copy the diagnostic below to report the cause.';
      }
      this.checkIdentity(); return snapshot;
    } catch (e) { if (snapshot) await this.release(snapshot); throw e instanceof SafeError ? e : readFailure(); }
  }
  async inspect(snapshot) {
    this.checkIdentity(); const digest = await digestDocument();
    if (digest !== snapshot.digest) snapshot.invalid = true;
    await Word.run(snapshot.range, async ctx => {
      const current = ctx.document.getSelection(); current.load('text'); const relation = current.compareLocationWith(snapshot.range); await ctx.sync();
      assertFresh(snapshot, { identity: this.identity, digest, source: current.text, relation: relation.value });
    });
  }
  async apply(snapshot, markdown, action) {
    if (this.busy) throw new SafeError('An edit is already running.'); this.busy = true; let mutationAttempted = false;
    try {
      await this.inspect(snapshot);
      // One mutation only. Word has no cross-platform compare-and-swap transaction.
      await Word.run(snapshot.range, async ctx => {
        this.checkIdentity(); const selected = ctx.document.getSelection(); selected.load('text,isEmpty');
        const relation = selected.compareLocationWith(snapshot.range);
        const target = action === 'after' && snapshot.source ? snapshot.range.getRange('End') : snapshot.range;
        const first = target.paragraphs.getFirst().getRange('Start'), last = target.paragraphs.getLast().getRange('End');
        const startRelation = target.getRange('Start').compareLocationWith(first), endRelation = target.getRange('End').compareLocationWith(last);
        const currentXml = selected.getOoxml(); selected.paragraphs.load('items'); const cell = selected.parentTableCellOrNullObject; cell.load('isNullObject');
        await ctx.sync();
        assertFresh(snapshot, { identity: this.identity, digest: snapshot.digest, source: selected.text, relation: relation.value });
        let wholeCell = false;
        if (!cell.isNullObject) { const comparison = selected.compareLocationWith(cell.body.getRange('Whole')); await ctx.sync(); wholeCell = !selected.isEmpty && comparison.value === 'Contains'; }
        validateSelection({ text: selected.text, xml: currentXml.value, paragraphs: selected.paragraphs.items.length, inCell: !cell.isNullObject, wholeCell });
        const ooxml = markdownToOoxml(markdown, {
          leadingBoundary: (action === 'after' && !!snapshot.source) || (!selected.isEmpty && startRelation.value !== 'Equal'),
          trailingBoundary: endRelation.value !== 'Equal'
        });
        mutationAttempted = true; target.insertOoxml(ooxml, 'Replace'); await ctx.sync();
      });
    } catch (e) { const error = e instanceof SafeError ? e : new SafeError('Word refused or could not confirm the edit. Check the document and its protection. The suggestion is retained for copying.'); error.uncertain = mutationAttempted; throw error; }
    finally { this.busy = false; }
  }
  async release(snapshot) { if (snapshot?.range) { try { await Word.run(snapshot.range, async ctx => { snapshot.range.untrack(); await ctx.sync(); }); } catch {} } }
}

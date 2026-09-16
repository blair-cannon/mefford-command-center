import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { prepareOcrAssets } from '../build/ocr-assets.ts';
import { browserOcrOptions, OCR_ASSET_PATH } from '../lib/ocr-assets.ts';
import { needsPageOcr, mergeRecognizedPage, boundedOcrScale } from '../lib/ocr-document.ts';
import { extractQuoteFields } from '../lib/quote-ocr.js';
import { harness, owner } from './support/project-workflow-harness.mjs';

test('image quotes, tilted scans, multipage scans and hybrid PDFs preserve price, scope, exclusions and originals', { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const assets = await prepareOcrAssets(root);
  const options = browserOcrOptions('https://command.example.invalid');
  for (const key of ['workerPath','corePath','langPath']) assert.equal(new URL(options[key]).origin, 'https://command.example.invalid');
  assert.equal(options.workerBlobURL, false);
  const worker = await createWorker('eng', 1, { langPath: assets, cacheMethod: 'none', gzip: true });
  const directory = fileURLToPath(new URL('./fixtures/scanned-quotes/', import.meta.url));
  const expected = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
  const scratch = await mkdtemp(`${tmpdir()}/meffcon-scanned-quotes-`);
  const h = await harness(), results = [];
  try {
    const vendor = await h.post('/api/procurement', { action:'create-prospective-vendor', scope:'Sales', legalName:'Synthetic Scan Bidder', contactName:'Scan Test', contactEmail:'scan-only@example.invalid' }, owner, 201);
    const secondVendor = await h.post('/api/procurement', { action:'create-prospective-vendor', scope:'Sales', legalName:'Other Synthetic Scan Bidder', contactName:'Second Scan Test', contactEmail:'scan-two@example.invalid' }, owner, 201);
    for (const [index, fixture] of expected.entries()) {
      const source = `${directory}/${fixture.file}`;
      const isPdf = fixture.file.endsWith('.pdf');
      let text = '', pages = 1;
      if (isPdf) {
        const embedded = execFileSync('pdftotext', ['-layout', source, '-'], {encoding:'utf8'}).split('\f');
        if (fixture.file.startsWith('hybrid')) assert.ok(embedded[0].trim().length > 40, 'Hybrid header reproduces the old incorrect skip condition');
        else assert.ok(!embedded.join('').trim(), 'Scanned PDF has no hidden quote text');
        const prefix = `${scratch}/${index}`;
        execFileSync('pdftoppm', ['-png', '-r', '144', source, prefix]);
        const images = (await readdir(scratch)).filter(name => name.startsWith(`${index}-`) && name.endsWith('.png')).sort();
        pages = images.length;
        for (const [page, image] of images.entries()) {
          assert.equal(needsPageOcr(embedded[page] || '', true), true);
          const recognized = await worker.recognize(`${scratch}/${image}`);
          text += mergeRecognizedPage(embedded[page] || '', recognized.data.text, page + 1) + '\n\n';
        }
      } else text = (await worker.recognize(source)).data.text;
      const extracted = extractQuoteFields(text);
      await writeFile(`${scratch}/${fixture.file}.ocr.txt`, text);
      assert.equal(extracted.price, fixture.price, `${fixture.file} total\n${text}`);
      const normalize = value => value.toLowerCase().replace(/\s+/g, ' ');
      for (const scope of fixture.scope) assert.ok(normalize(extracted.scope).includes(normalize(scope)), `${fixture.file} missing ${scope}\n${text}`);
      for (const exclusion of fixture.exclusions) assert.ok(normalize(extracted.exclusions).includes(normalize(exclusion)), `${fixture.file} missing exclusion ${exclusion}\n${text}`);
      const opportunityId = `SCAN-OPP-${index}`;
      await h.save('MEFFORD-SALES','Sales Opportunities',opportunityId,'New Lead',{stage:'New Lead',projectName:`Synthetic Scanned Quote ${index}`,company:'Fictional Scan Client',assignedRep:owner.name});
      const created = await h.post('/api/procurement',{action:'create-package',scope:'Sales',opportunityId,title:`Scanned quote package ${index}`,trade:'Electrical',costCode:'2600',deadline:new Date(Date.now()+7*86400000).toISOString(),scopeDescription:fixture.scope.join('\n')},owner,201);
      const form = new FormData(); form.set('projectId',`ESTIMATE-${opportunityId}`);form.set('category','03-Estimating - Quotes');form.set('access','Internal Procurement');form.set('file',new File([await readFile(source)],fixture.file,{type:isPdf?'application/pdf':fixture.file.endsWith('.jpg')?'image/jpeg':'image/png'}));
      const upload = await h.post('/api/files',form,owner,201);
      const quote = {fileId:upload.file.id,confirmed:true,reviewedPrice:extracted.price,reviewedScope:extracted.scope,extractedPrice:extracted.price,extractedScope:extracted.scope,characterCount:extracted.characterCount,exclusions:extracted.exclusions,alternates:extracted.alternates,allowances:extracted.allowances,qualifications:extracted.qualifications,clarifications:extracted.clarifications,schedule:extracted.schedule};
      const payload = {action:'record-quote',scope:'Sales',recordId:created.recordId,vendorId:vendor.vendorId,quote};
      const recorded = await h.post('/api/procurement',payload,owner,201);
      const repeated = await h.post('/api/procurement',payload,owner,201);
      assert.equal(repeated.alreadyRecorded,true);assert.equal(repeated.bidRevisionId,recorded.bidRevisionId);
      await h.post('/api/procurement',{...payload,quote:{...quote,reviewedPrice:quote.reviewedPrice+1}},owner,409);
      await h.post('/api/procurement',{...payload,vendorId:secondVendor.vendorId},owner,409);
      const saved = h.row('MEFFORD-SALES',created.recordId).data;
      assert.equal(saved.bidders.length,1);assert.equal(saved.bidders[0].revisions.length,1);
      assert.equal(saved.bidders[0].revisions[0].ocr.reviewedScope,extracted.scope);
      assert.deepEqual(Buffer.from(await h.send(`/api/files?id=${upload.file.id}`,{binary:true})),await readFile(source));
      results.push({file:fixture.file,pages,price:extracted.price,scopeRequirements:fixture.scope.length,exclusions:fixture.exclusions.length,originalRetained:true,retryDidNotDuplicate:true,passed:true});
      t.diagnostic(`${fixture.file}: $${extracted.price.toFixed(2)}, ${fixture.scope.length} scope items, ${pages} page(s)`);
    }
    assert.equal(h.outbound.length,0);
  } finally {
    await writeFile('docs/scanned-quote-results-2026-09-11.json',JSON.stringify({runAt:new Date().toISOString(),recognition:'Actual Tesseract 6.0.1 / core 6.1.2 / English 1.0.0 on image pixels; PDF rasterization by Poppler',assetPath:OCR_ASSET_PATH,applicationRuntime:process.env.LIFECYCLE_SOURCE==='1'?'source handlers':'compiled Worker',browserUploadVerified:false,results},null,2)+'\n');
    await worker.terminate();await h.close();await rm(scratch,{recursive:true,force:true});
  }
  assert.equal(results.length,4);
});

test('OCR bounds large pages and requires manual selection for conflicting quote totals', () => {
  const scale = boundedOcrScale(10000,10000);assert.ok((10000*scale)**2<=8_000_000);assert.ok(10000*scale<=4096);
  assert.equal(needsPageOcr('Full embedded scope and price text on a digitally generated quote.',false),false);
  const ambiguous = extractQuoteFields('Grand Total: $850.25\nGrand Total: $950.25');
  assert.equal(ambiguous.price,0);assert.equal(ambiguous.confidence,'Review Required');assert.equal(ambiguous.priceWarnings.length,1);
  assert.equal(extractQuoteFields('Total Days: 14\nQuote reference: 20260911').price,0);
  assert.equal(extractQuoteFields('Grand Total: -$850.25').price,0);
  assert.equal(extractQuoteFields('Grand Total:\n$850.25').price,850.25);
  assert.equal(extractQuoteFields('Grand Total: $850.25\nGrand Total: $850.25').price,850.25);
});

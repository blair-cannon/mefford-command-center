import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, owner, accountant, pm, today } from './support/project-workflow-harness.mjs';
import { postAccountingEvent, ownerReceiptLines, setAccountingPeriod } from '../lib/accounting-ledger.ts';
const company='MEFFORD-ACCOUNTING';
const journal=(overrides={})=>({entryDate:today,entryType:'Standard',reference:'SYNTHETIC audit journal',description:'SYNTHETIC balanced opening cash',supportReference:'SYNTHETIC original evidence',lines:[{accountNumber:'1020',accountName:'Cash Clear',debit:100.25,credit:0},{accountNumber:'4020',accountName:'Accounts Payable',debit:0,credit:100.25}],...overrides});
const action=(h,action,extra={},actor=accountant,status=200)=>h.post('/api/accounting',{action,...extra},actor,status);
const control=(h,action,extra={},actor=accountant,status=200)=>h.post('/api/accounting-controls',{action,...extra},actor,status);
const normalized=(h,id)=>h.runtime.database.one('SELECT * FROM accounting_journal_entries WHERE id=?',id);

// These fault tests exercise the real routes. No successful financial action is
// inferred from a source-code pattern or from a mocked posting implementation.
test('accounting operational audit: journal draft source, normalized ledger and audit save atomically',async()=>{
 const h=await harness();try{
  h.runtime.database.injectFailure({pattern:/INSERT INTO command_records/});
  await action(h,'save-journal-entry',{journal:journal()},accountant,500);
  assert.equal(h.runtime.database.one('SELECT COUNT(*) AS n FROM accounting_journal_entries').n,0,'Failed source save cannot leave an orphan normalized journal');
  const made=await action(h,'save-journal-entry',{journal:journal()});
  assert.equal(normalized(h,made.id).status,'Draft');assert.equal(h.row(company,made.id).status,'Draft');
 }finally{await h.close();}
});

test('accounting operational audit: submission, independent approval, posting and reversal survive interrupted writes',async()=>{
 const h=await harness();try{
  const made=await action(h,'save-journal-entry',{journal:journal()});const recordId=made.id;
  for(const [step,prior,actor] of [['submit-journal-entry','Draft',accountant],['approve-journal-entry','Submitted',owner],['post-journal-entry','Approved',accountant]]){
   h.runtime.database.injectFailure({pattern:/UPDATE command_records/});
   await action(h,step,{recordId},actor,500);
   assert.equal(normalized(h,recordId).status,prior,`${step} normalized state rolls back with source`);assert.equal(h.row(company,recordId).status,prior);
   await action(h,step,{recordId},actor);
  }
  await action(h,'post-journal-entry',{recordId},accountant,409);
  assert.equal(h.runtime.database.one("SELECT COUNT(*) AS n FROM accounting_events WHERE source_record_id=?",recordId).n,1);
  h.runtime.database.injectFailure({pattern:/INSERT INTO command_records/});
  await action(h,'reverse-journal-entry',{recordId},accountant,500);
  assert.equal(h.runtime.database.one('SELECT COUNT(*) AS n FROM accounting_journal_entries').n,1,'Failed reversal cannot leave an orphan or freeze the original');
  assert.equal(h.row(company,recordId).data.reversedByEntryId,undefined);
  const reversed=await action(h,'reverse-journal-entry',{recordId});
  await action(h,'reverse-journal-entry',{recordId},accountant,409);
  await action(h,'submit-journal-entry',{recordId:reversed.id});
  await action(h,'approve-journal-entry',{recordId:reversed.id},accountant,403);
  await action(h,'approve-journal-entry',{recordId:reversed.id},owner);
  await action(h,'post-journal-entry',{recordId:reversed.id});
  const ledger=await h.send('/api/accounting',{actor:accountant});
  for(const row of ledger.trialBalance)assert.equal(Math.round((row.debit-row.credit)*100),0);
  assert.equal(normalized(h,recordId).status,'Posted');
 }finally{await h.close();}
});

test('accounting operational audit: work in progress journals can be saved, but invalid dates and unbalanced posting are blocked',async()=>{
 const h=await harness();try{
  const unbalanced=journal({lines:[{accountNumber:'1020',accountName:'Cash',debit:100,credit:0},{accountNumber:'4020',accountName:'AP',debit:0,credit:99}]});
  const draft=await action(h,'save-journal-entry',{journal:unbalanced});
  await action(h,'submit-journal-entry',{recordId:draft.id},accountant,400);
  await action(h,'save-journal-entry',{journal:journal({id:draft.id})});
  await action(h,'submit-journal-entry',{recordId:draft.id});
  await action(h,'approve-journal-entry',{recordId:draft.id},accountant,403);
  await action(h,'save-journal-entry',{journal:journal({entryDate:'2026-02-30'})},accountant,400);
  await action(h,'save-journal-entry',{journal:journal({lines:[{accountNumber:'1020',accountName:'Cash',debit:'not a number'},{accountNumber:'4020',accountName:'AP',credit:100}]})},accountant,400);
  await action(h,'save-journal-entry',{journal:journal()},pm,403);
 }finally{await h.close();}
});

test('accounting operational audit: hard close cannot be downgraded to soft close and posting cannot race a period lock',async()=>{
 const h=await harness();try{
  const periodId=today.slice(0,7);
  await setAccountingPeriod(h.runtime.database,{periodId,status:'Hard Closed',actor:owner,isOwner:true});
  await assert.rejects(setAccountingPeriod(h.runtime.database,{periodId,status:'Soft Closed',actor:accountant,isOwner:false}),/reopen|Hard Closed/i);
  assert.equal(h.runtime.database.one('SELECT status FROM accounting_periods WHERE id=?',periodId).status,'Hard Closed');
  await setAccountingPeriod(h.runtime.database,{periodId,status:'Open',actor:owner,isOwner:true,reason:'SYNTHETIC correction approval'});
  const realBatch=h.runtime.database.batch.bind(h.runtime.database);let raced=false;
  h.runtime.database.batch=async statements=>{
   if(!raced&&statements.some(s=>s.sql.includes('INSERT INTO accounting_events'))){raced=true;await setAccountingPeriod(h.runtime.database,{periodId,status:'Hard Closed',actor:owner,isOwner:true});}
   return realBatch(statements);
  };
  await assert.rejects(postAccountingEvent(h.runtime.database,{idempotencyKey:'RACE-LOCK',eventType:'Owner Receipt Posted',sourceType:'Owner Receipt',sourceRecordId:'RACE-LOCK',eventDate:today,reference:'SYNTHETIC',description:'SYNTHETIC lock race',actor:accountant,lines:ownerReceiptLines(100,'SYNTHETIC','SYNTHETIC receipt')}));
  assert.equal(h.runtime.database.one('SELECT COUNT(*) AS n FROM accounting_events').n,0);
 }finally{await h.close();}
});

test('accounting operational audit: a period can close only after evidence review, and closed evidence stays locked',async()=>{
 const h=await harness();try{
  const period={id:today.slice(0,7),status:'Hard Closed'};
  await action(h,'close-accounting-period',{period},owner,409);
  const codes=['CASH','AP','AR','PAYROLL','WIP','ASSETS','JE','TB','PACKAGE','OWNER'];
  for(const code of codes){
   const maker=code==='OWNER'?owner:accountant,reviewer=code==='OWNER'?accountant:owner;
   await control(h,'update-close-task',{closeTask:{periodId:period.id,code,status:'Completed',evidence:`SYNTHETIC ${code} completed reconciled evidence`}},maker);
   await control(h,'update-close-task',{closeTask:{periodId:period.id,code,status:'Reviewed',evidence:`SYNTHETIC ${code} independently checked`}},maker,409);
   await control(h,'update-close-task',{closeTask:{periodId:period.id,code,status:'Reviewed',evidence:`SYNTHETIC ${code} independently checked`}},reviewer);
  }
  await action(h,'close-accounting-period',{period},owner);
  await control(h,'update-close-task',{closeTask:{periodId:period.id,code:'AP',status:'Open'}},accountant,423);
  await action(h,'reopen-accounting-period',{period:{id:period.id,reason:'SYNTHETIC approved correction to reconciled close'}},owner);
 }finally{await h.close();}
});

test('accounting operational audit: bank matches remain one-to-one under competing requests',async()=>{
 const h=await harness();try{
  const cash=await action(h,'save-cash-account',{account:{name:'SYNTHETIC Bank',lastFour:'1234',bookBalance:1000,bankBalance:1000,statementDate:today}});
  await control(h,'import-bank-transactions',{transactionImport:{cashAccountId:cash.id,transactions:[['BOOK','Book'],['BANK-A','Bank'],['BANK-B','Bank']].map(([id,source])=>({id,source,transactionDate:today,reference:id,description:'SYNTHETIC exact-cent bank match',amount:100}))}});
  const original=h.runtime.database.batch.bind(h.runtime.database);let raced=false;
  h.runtime.database.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.includes('UPDATE accounting_bank_transactions'))){raced=true;await control(h,'match-bank-transactions',{match:{bookTransactionId:'BOOK',bankTransactionId:'BANK-B'}});}return original(statements);};
  await control(h,'match-bank-transactions',{match:{bookTransactionId:'BOOK',bankTransactionId:'BANK-A'}},accountant,409);
  assert.equal(h.runtime.database.one("SELECT matched_transaction_id FROM accounting_bank_transactions WHERE id='BOOK'").matched_transaction_id,'BANK-B');
  assert.equal(h.runtime.database.one("SELECT status FROM accounting_bank_transactions WHERE id='BANK-A'").status,'Unmatched');
 }finally{await h.close();}
});

test('accounting operational audit: WIP approval cannot silently replace the numbers independently reviewed',async()=>{
 const h=await harness();try{
  // Historical control fixture: the route under test owns all forecast writes.
  h.runtime.database.sqlite.prepare("INSERT INTO projects(number,name,status,site,owner_name,owner_contract_date,project_type,start_date,substantial_date,final_date,project_manager,superintendent,contract_amount,current_contract_amount) VALUES('SYNTHETIC-WIP','SYNTHETIC WIP','Active','Test','Test', '2026-01-01','Commercial','2026-01-01','2026-12-01','2026-12-31','Test','Test','10000','10000')").run();
  const wip={projectId:'SYNTHETIC-WIP',periodId:today.slice(0,7),estimateToComplete:1000,riskReserve:50,status:'Accounting Reviewed'};
  await control(h,'save-wip-forecast',{wip});
  await control(h,'save-wip-forecast',{wip:{...wip,status:'Locked',estimateToComplete:2000}},owner,409);
  await control(h,'save-wip-forecast',{wip:{...wip,status:'Locked'}},owner);
  await control(h,'save-wip-forecast',{wip:{...wip,status:'Draft'}},accountant,423);
  await control(h,'save-wip-forecast',{wip:{...wip,periodId:'2026-99'}},accountant,400);
  await control(h,'save-wip-forecast',{wip:{...wip,periodId:'2027-01',estimateToComplete:-1}},accountant,400);
 }finally{await h.close();}
});

test('accounting operational audit: collections use project-qualified billing identity and the cash horizon excludes later receipts',async()=>{
 const h=await harness();try{
  for(const [id,due] of [['SYNTHETIC-A',today],['SYNTHETIC-B','2099-01-01']])h.runtime.database.sqlite.prepare("INSERT INTO command_records(project_id,id,record_type,title,owner,due,status,data_json) VALUES(?,'BILL-001','Owner Billing',?,'Synthetic',?,'Sent',?)").run(id,id,due,JSON.stringify({currentPaymentDue:100,receivedToDate:0}));
  await control(h,'record-collection-action',{collection:{projectId:'SYNTHETIC-A',billingId:'BILL-001',actionDate:today,method:'Call',note:'SYNTHETIC collection belongs only to A'}});
  const controls=await h.send('/api/accounting-controls',{actor:accountant});
  assert.equal(controls.arAging.find(r=>r.projectId==='SYNTHETIC-B').latestAction,null);
  assert.equal(controls.arAging.find(r=>r.projectId==='SYNTHETIC-A').latestAction.project_id,'SYNTHETIC-A');
  assert.equal(controls.cashForecast.weeks.reduce((sum,w)=>sum+w.inflow,0),100,'A payment due outside thirteen weeks is not moved into the last week');
 }finally{await h.close();}
});

test('accounting operational audit: vendor paid totals follow payment year rather than invoice year',async()=>{
 const h=await harness();try{
  const vendor=(await h.post('/api/vendors',{action:'create-vendor',legalName:'SYNTHETIC Paid-Year Vendor',vendorType:'Subcontractor',contactName:'Test Supplier',contactEmail:'paid-year@example.invalid'},owner,201)).vendorId;
  const lastYear=Number(today.slice(0,4))-1;
  h.runtime.database.sqlite.prepare("INSERT INTO command_records(project_id,id,record_type,title,owner,due,status,record_date,data_json) VALUES(?,'PRIOR-INVOICE','AP Invoice','SYNTHETIC Prior Invoice','Synthetic',?,'Paid',?,?)").run(company,today,`${lastYear}-12-15`,JSON.stringify({vendorId:vendor,total:1234.56,paidAt:`${today}T12:00:00Z`}));
  const row=(await h.send('/api/accounting-controls',{actor:accountant})).vendorTaxReadiness.find(r=>r.vendorId===vendor);
  assert.equal(row.ytdPaid,1234.56);assert.equal(row.review1099,true);
 }finally{await h.close();}
});

test('accounting operational audit: bank reconciliation approval rejects concurrent edits and locks approved evidence',async()=>{
 const h=await harness();try{
  const cash=await action(h,'save-cash-account',{account:{name:'SYNTHETIC Reconciliation Bank',lastFour:'1234',bookBalance:5000.05,bankBalance:5000.05,statementDate:today}});
  const reconciliation={cashAccountId:cash.id,statementStart:today,statementEnd:today,statementEndingBalance:5000.05,bookEndingBalance:5000.05,outstandingDeposits:0,outstandingPayments:0,adjustment:0};
  const saved=await control(h,'save-bank-reconciliation',{reconciliation});
  const original=h.runtime.database.beforeStatement.bind(h.runtime.database);let raced=false;
  h.runtime.database.beforeStatement=(sql)=>{if(!raced&&sql.includes("SET status = 'Approved'")&&sql.includes('accounting_bank_reconciliations')){raced=true;h.runtime.database.sqlite.prepare("UPDATE accounting_bank_reconciliations SET difference_cents=100,status='Needs Review',updated_at='raced' WHERE id=?").run(saved.id);}return original(sql);};
  await control(h,'approve-bank-reconciliation',{recordId:saved.id},owner,409);
  assert.equal(h.runtime.database.one('SELECT status FROM accounting_bank_reconciliations WHERE id=?',saved.id).status,'Needs Review');
  await control(h,'save-bank-reconciliation',{reconciliation:{...reconciliation,id:saved.id}});
  await control(h,'approve-bank-reconciliation',{recordId:saved.id},owner);
  await control(h,'save-bank-reconciliation',{reconciliation:{...reconciliation,id:saved.id}},accountant,423);
  await control(h,'save-bank-reconciliation',{reconciliation:{...reconciliation,statementEnd:'2026-02-30'}},accountant,400);
  await control(h,'save-bank-reconciliation',{reconciliation:{...reconciliation,outstandingDeposits:-100}},accountant,400);
 }finally{await h.close();}
});

test('accounting operational audit: locked WIP has a controlled correction path and excludes later-period costs',async()=>{
 const h=await harness();try{
  h.runtime.database.sqlite.prepare("INSERT INTO projects(number,name,status,site,owner_name,owner_contract_date,project_type,start_date,substantial_date,final_date,project_manager,superintendent,contract_amount,current_contract_amount) VALUES('SYNTHETIC-WIP','SYNTHETIC WIP','Active','Test','Test','2026-01-01','Commercial','2026-01-01','2026-12-01','2026-12-31','Test','Test','10000','10000')").run();
  for(const [id,date,amount]of[['PAST','2026-01-15',100],['FUTURE','2099-01-15',900]])h.runtime.database.sqlite.prepare("INSERT INTO command_records(project_id,id,record_type,title,owner,due,status,record_date,data_json) VALUES('SYNTHETIC-WIP',?,'Job Cost Actual',?,'Synthetic',?,'Posted',?,?)").run(id,id,date,date,JSON.stringify({amount}));
  const wip={projectId:'SYNTHETIC-WIP',periodId:today.slice(0,7),estimateToComplete:1000,riskReserve:0,status:'Accounting Reviewed'};
  const made=await control(h,'save-wip-forecast',{wip});
  assert.equal(h.runtime.database.one('SELECT actual_cost_cents FROM accounting_wip_forecasts WHERE id=?',made.id).actual_cost_cents,10000);
  await control(h,'save-wip-forecast',{wip:{...wip,status:'Locked'}},owner);
  await control(h,'reopen-wip-forecast',{wip:{...wip,reason:'SYNTHETIC approved correction'}},accountant,403);
  await control(h,'reopen-wip-forecast',{wip:{...wip,reason:'SYNTHETIC approved correction'}},owner);
  const row=h.runtime.database.one('SELECT * FROM accounting_wip_forecasts WHERE id=?',made.id);assert.equal(row.status,'Draft');assert.equal(row.reviewed_email,'');assert.equal(row.approved_email,'');
  assert.match(h.runtime.database.one("SELECT summary FROM record_audits WHERE record_id=? AND summary LIKE '%WIP Reopened%'",made.id).summary,/SYNTHETIC approved correction/);
  await control(h,'save-wip-forecast',{wip:{...wip,estimateToComplete:1200,status:'Locked'}},owner,409);
  await control(h,'save-wip-forecast',{wip:{...wip,estimateToComplete:1200}});
  await control(h,'save-wip-forecast',{wip:{...wip,estimateToComplete:1200,status:'Locked'}},owner);
 }finally{await h.close();}
});

test('accounting operational audit: asset draft remains linked through edit, independent approval and ledger posting',async()=>{
 const h=await harness();try{
  const {assetId}=await h.post('/api/assets',{action:'create-asset',assetTag:'SYNTHETIC-GL-01',category:'Vehicle',description:'SYNTHETIC accounting truck',acquisitionCost:20000,homeLocation:'Synthetic yard'},owner,201);
  await h.post('/api/assets',{action:'create-asset-journal-draft',assetId,journalEvent:'Capitalization',journalAmount:20000,entryDate:today,assetAccountNumber:'2110',assetAccountName:'Company Vehicles',offsetAccountNumber:'4020',offsetAccountName:'Accounts Payable'},accountant);
  const record=h.runtime.database.one("SELECT * FROM command_records WHERE project_id=? AND record_type='Journal Entry'",company),details=JSON.parse(record.data_json);
  await action(h,'save-journal-entry',{journal:{...details,description:'SYNTHETIC edited asset capitalization'}});
  assert.equal(h.row(company,record.id).data.sourceAssetId,assetId);
  await action(h,'submit-journal-entry',{recordId:record.id});await action(h,'approve-journal-entry',{recordId:record.id},owner);await action(h,'post-journal-entry',{recordId:record.id});
  const ledger=await h.send('/api/accounting',{actor:accountant});assert.equal(ledger.journalEntries.find(row=>row.id===record.id).status,'Posted');
  assert.equal(ledger.trialBalance.find(row=>row.accountNumber==='2110').debit,20000);
  assert.ok(h.runtime.database.one("SELECT id FROM domain_events WHERE aggregate_id=?",record.id));
 }finally{await h.close();}
});

test('accounting operational audit: payroll packet and returned report reconcile without executing a payment',async()=>{
 const h=await harness();try{
  const payroll={periodStart:today,periodEnd:today,payDate:today,employee:'SYNTHETIC Employee',regularHours:40,allocations:[{destination:'Company Overhead',code:'8290',hours:40}]};
  await action(h,'save-payroll-report',{payroll:{...payroll,periodEnd:'2026-02-30'}},accountant,400);
  await action(h,'save-payroll-report',{payroll:{...payroll,allocations:[{destination:'Company Overhead',code:'8290',hours:39}]}},accountant,400);
  const packet=await action(h,'save-payroll-report',{payroll});assert.equal(h.row(company,packet.id).data.paymentExecutionDisabled,true);
  const payrollReturn={periodStart:today,periodEnd:today,payDate:today,returnReference:'SYNTHETIC returned payroll evidence',grossWages:1000,employerTaxes:100,employerBenefits:50,employeeDeductions:100,netPay:800,allocations:[{destination:'Company Overhead',code:'8290',amount:1150}]};
  await action(h,'record-paylocity-return',{payrollReturn:{...payrollReturn,grossWages:'invalid'}},accountant,400);
  await action(h,'record-paylocity-return',{payrollReturn:{...payrollReturn,allocations:[{destination:'Company Overhead',code:'8290',amount:1150.01}]}},accountant,400);
  await action(h,'record-paylocity-return',{payrollReturn});await action(h,'record-paylocity-return',{payrollReturn},accountant,409);
  const ledger=await h.send('/api/accounting',{actor:accountant});assert.equal(ledger.trialBalance.find(row=>row.accountNumber==='8290').debit,1150);assert.equal(ledger.trialBalance.find(row=>row.accountNumber==='4980').credit,1150);assert.equal(h.outbound.length,0);
 }finally{await h.close();}
});

test('accounting operational audit: cutover requires a posted opening balance and forecast items can be corrected',async()=>{
 const h=await harness();try{
  const cutover={cutoverDate:today,sourceSystem:'SYNTHETIC historical ledger',apReconciled:true,arReconciled:true,cashReconciled:true,assetsReconciled:true,payrollReconciled:true,equityReconciled:true,evidence:'SYNTHETIC reconciled subsidiary ledgers',status:'Locked'};
  await control(h,'save-cutover-control',{cutover},owner,400);
  const made=await action(h,'save-journal-entry',{journal:journal({entryType:'Opening Balance'})});await action(h,'submit-journal-entry',{recordId:made.id});await action(h,'approve-journal-entry',{recordId:made.id},owner);await action(h,'post-journal-entry',{recordId:made.id});
  await control(h,'save-cutover-control',{cutover:{...cutover,openingBalanceEntryId:made.id}},accountant,403);
  await control(h,'save-cutover-control',{cutover:{...cutover,openingBalanceEntryId:made.id}},owner);
  await control(h,'save-cutover-control',{cutover:{...cutover,status:'Draft'}},owner,423);
  const forecastItem={weekStart:today,direction:'Outflow',category:'Equipment',description:'SYNTHETIC planned purchase',amount:1000};const item=await control(h,'save-cash-forecast-item',{forecastItem});
  await control(h,'save-cash-forecast-item',{forecastItem:{...forecastItem,id:item.id,amount:1500}});
  assert.equal((await h.send('/api/accounting-controls',{actor:accountant})).cashForecast.weeks.reduce((s,w)=>s+w.outflow,0),1500);
  await control(h,'remove-cash-forecast-item',{recordId:item.id});assert.equal((await h.send('/api/accounting-controls',{actor:accountant})).cashForecast.weeks.reduce((s,w)=>s+w.outflow,0),0);
 }finally{await h.close();}
});

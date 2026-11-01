import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseYahooQuote, validQuote, quoteEligible, quoteStatus } from '../../src/lib/quote.ts';
import { refreshQuote } from '../update-quote.mjs';
const NOW = Date.parse('2026-11-01T14:00:00Z');
const TIME = Date.parse('2026-10-30T20:47:43Z');
const meta = { symbol:'^GSPC',instrumentType:'INDEX',regularMarketPrice:7580.07,regularMarketTime:TIME/1000,currentTradingPeriod:{regular:{end:Date.parse('2026-10-30T20:00:00Z')/1000}} };
const payload = (overrides={}) => ({chart:{result:[{meta:{...meta,...overrides}}],error:null}});
test('SPX quote preserves observed time, real index units and weekend last close',()=>{
 const q=parseYahooQuote(payload(),NOW);
 assert.equal(q.price,7580.07);assert.equal(q.time,TIME);assert.equal(q.fetchedAt,new Date(NOW).toISOString());
 assert.equal(quoteStatus(q,NOW),'last close');assert.ok(quoteEligible(q,'2026-10-30',NOW));
 assert.equal(quoteEligible(q,'2026-10-31',NOW),false);
 assert.equal(q.price/412.91,18.357680850548544);
});
test('Reject malformed, wrong instrument, old, future and nonnumeric quotes',()=>{
 for(const change of [{symbol:'SPY'},{instrumentType:'ETF'},{regularMarketPrice:0},{regularMarketPrice:'7580'},{regularMarketTime:'1793393263'},{regularMarketTime:null},{regularMarketTime:NOW/1000+61},{regularMarketTime:NOW/1000-8*86400}]) assert.throws(()=>parseYahooQuote(payload(change),NOW));
 for(const value of [null,{}, {chart:{error:'bad',result:[{meta}]}}]) assert.throws(()=>parseYahooQuote(value,NOW));
 const q=parseYahooQuote(payload(),NOW);assert.equal(validQuote({...q,fetchedAt:'bad'},NOW),false);assert.equal(validQuote({...q,fetchedAt:new Date(NOW+120000).toISOString()},NOW),false);
});
test('Intraday freshness never implies continuously live quote',()=>{
 const q=parseYahooQuote(payload({regularMarketTime:(NOW-10000)/1000,currentTradingPeriod:undefined}),NOW);
 assert.equal(quoteStatus(q,NOW),'latest quote');assert.equal(quoteStatus(q,NOW+2*3600000),'aged quote');
});
async function file() {return pathToFileURL(`${await mkdtemp(`${tmpdir()}/spx-quote-`)}/latest-quote.json`);}
test('Successful refresh writes actual provider observation and provenance',async()=>{
 const output=await file(); const result=await refreshQuote({output,nowMs:NOW,fetchImpl:async()=>({ok:true,json:async()=>payload()})});
 assert.equal(result.updated,true);assert.deepEqual(JSON.parse(await readFile(output,'utf8')),parseYahooQuote(payload(),NOW));
});
test('Provider failure recovers newer deployed artifact without faking fetchedAt',async()=>{
 const output=await file(),q=parseYahooQuote(payload(),NOW);const older={...q,time:TIME-86400000,fetchedAt:new Date(NOW-86400000).toISOString()};
 await writeFile(output,JSON.stringify(older));let calls=0;
 const result=await refreshQuote({output,nowMs:NOW,fetchImpl:async()=>{calls++;if(calls===1)throw Error('Unavailable');return {ok:true,json:async()=>q};}});
 assert.equal(result.updated,false);assert.equal(result.quote.fetchedAt,q.fetchedAt);assert.equal(result.quote.time,TIME);assert.deepEqual(JSON.parse(await readFile(output,'utf8')),q);
});
test('Malformed/regressed quote retains seed; no previous data fails visibly',async()=>{
 const output=await file(),q=parseYahooQuote(payload(),NOW);await writeFile(output,JSON.stringify(q));
 const before=await readFile(output,'utf8');let calls=0;
 const result=await refreshQuote({output,nowMs:NOW,fetchImpl:async()=>{calls++;return calls===1?{ok:true,json:async()=>payload({regularMarketTime:(TIME-3600000)/1000})}:{ok:false,status:404};}});
 assert.equal(result.updated,false);assert.equal(await readFile(output,'utf8'),before);
 await assert.rejects(refreshQuote({output:await file(),nowMs:NOW,fetchImpl:async()=>{throw Error('Offline');}}));
});
test('Successful but regressed Yahoo observation cannot replace a newer deployed quote',async()=>{
 const output=await file();
 const seed=parseYahooQuote(payload({regularMarketTime:(TIME-7200000)/1000}),NOW-3600000);
 const deployed=parseYahooQuote(payload(),NOW-600000);
 await writeFile(output,JSON.stringify(seed));
 const result=await refreshQuote({output,nowMs:NOW,fetchImpl:async(url)=>({ok:true,json:async()=>url.includes('query1')?payload({regularMarketTime:(TIME-3600000)/1000}):deployed})});
 assert.equal(result.updated,false);assert.deepEqual(result.quote,deployed);assert.equal(result.quote.fetchedAt,deployed.fetchedAt);
 assert.deepEqual(JSON.parse(await readFile(output,'utf8')),deployed);
});
test('A newer Yahoo quote outranks the deployed artifact; unavailable deployed endpoint does not block success',async()=>{
 for(const deployedAvailable of [true,false]) {
  const output=await file(),older=parseYahooQuote(payload({regularMarketTime:(TIME-3600000)/1000}),NOW-600000);
  await writeFile(output,JSON.stringify(older));
  const result=await refreshQuote({output,nowMs:NOW,fetchImpl:async(url)=>{
   if(url.includes('query1'))return {ok:true,json:async()=>payload()};
   if(!deployedAvailable)throw Error('Deployed endpoint unavailable');
   return {ok:true,json:async()=>older};
  }});
  assert.equal(result.updated,true);assert.equal(result.quote.time,TIME);assert.equal(result.quote.fetchedAt,new Date(NOW).toISOString());
 }
});

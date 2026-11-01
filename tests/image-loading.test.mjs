import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { checkDesignRequirementFront } from '../src/design-spec-checklist.mjs';
import { imageLoadTimeout, DEFAULT_IMAGE_LOAD_TIMEOUT_MS, preparePrimaryImages } from '../src/image-readiness.mjs';
import { measuredImagePage } from './helpers/image-page.mjs';
import { loadConfig } from '../src/config.mjs';
import { validateDesignSpec } from '../src/design-spec-checklist.mjs';
import { resolveImageRatioSource } from '../src/image-geometry.mjs';

const requirement = { id:'content-ratio', checkType:'image-ratio', sourceText:'Image ratio', checkStage:'front',
  expected:{ratio:'1:1',centered:true},params:{} };
async function fixture(query, work, viewport={width:1280,height:720}) {
  const browser=await chromium.launch({channel:'chrome'});
  try { const page=await browser.newPage({viewport});
    const url=new URL('./fixtures/image-loading/index.html',import.meta.url);url.search=query;
    await page.goto(url.href);await page.evaluate(()=>scrollTo(0,120));
    await work(page);
  } finally {await browser.close();}
}
const check=(page,params={},timeout=1800)=>checkDesignRequirementFront({...requirement,params},
  {page,rootSelector:'#instance',imageLoadTimeoutMs:timeout});

for(const viewport of [{width:1280,height:720},{width:375,height:667}]) {
  test(`scroll-only lazy loading decides ratio and restores scroll at ${viewport.width}px`,async()=>fixture('',async page=>{
    assert.equal(await page.locator('img').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length),0);
    const before=await page.evaluate(()=>({x:scrollX,y:scrollY,lazy:[...document.images].map(n=>[n.getAttribute('data-src'),n.getAttribute('data-original')])}));
    const result=await check(page);
    assert.equal(result.status,'pass',JSON.stringify(result));
    assert.equal(result.actual.imageLoad.total,2);assert.equal(result.actual.imageLoad.loaded,2);
    assert.equal(result.actual.imageLoad.scrollRestored,true);assert.ok(result.actual.imageLoad.scrollSteps>2);
    assert.ok(result.actual.images.every(n=>n.metrics.natural.ratio===1&&n.metrics.rendered.ratio===1));
    const after=await page.evaluate(()=>({x:scrollX,y:scrollY,lazy:[...document.images].map(n=>[n.getAttribute('data-src'),n.getAttribute('data-original')])}));
    assert.deepEqual(after,before);assert.equal(await page.evaluate(()=>sourceWrites),2);
  },viewport));
}

test('unloaded sources stay na after one total timeout, without source writes',async()=>fixture('never=1',async page=>{
  const result=await check(page,{},450);
  assert.equal(result.status,'na');assert.equal(result.reason.code,'primary-image-dimensions-unavailable');
  assert.equal(result.actual.imageLoad.timedOut,true);assert.equal(result.actual.imageLoad.loaded,0);
  assert.equal(result.actual.imageLoad.total,2);assert.equal(result.actual.imageLoad.scrollRestored,true);
  assert.ok(result.actual.imageLoad.elapsedMs<1000,JSON.stringify(result.actual.imageLoad));
  assert.equal(await page.evaluate(()=>scrollY),120);assert.equal(await page.evaluate(()=>sourceWrites),0);
  assert.equal(await page.locator('img[src],img[srcset]').count(),0);
}));

test('wrong loaded natural ratio fails even when element boxes are square',async()=>fixture('wide=1',async page=>{
  const result=await check(page);
  assert.equal(result.status,'fail');assert.equal(result.reason.code,'image-ratio-mismatch');
  assert.ok(result.actual.images.every(n=>n.metrics.natural.ratio===2&&n.metrics.elementBox.ratio===1));
  assert.equal(result.actual.measurementSource.origin,'legacy-natural-default');
}));

for(const [fit,source,status] of [['cover','rendered-content','pass'],['cover','natural','fail'],
  ['contain','rendered-content','fail'],['contain','rendered-element','pass'],['cover','both','fail']]) {
  test(`${fit}: checklist ${source} governs, not whichever ratio passes`,async()=>fixture(`wide=1&fit=${fit}&padding=1`,async page=>{
    const result=await check(page,{ratioSource:source});assert.equal(result.status,status,JSON.stringify(result));
    const metric=result.actual.images[0].metrics;
    assert.equal(metric.natural.ratio,2);assert.equal(metric.contentBox.width,100);assert.equal(metric.elementBox.width,124);
    assert.equal(metric.rendered.ratio,fit==='cover'?1:2);assert.equal(metric.rendered.cropped,fit==='cover');
    assert.equal(result.actual.images[0].decidingSource,source);
  }));
}

test('budget parsing and spec source resolution fail closed',()=>{
  assert.equal(imageLoadTimeout(),DEFAULT_IMAGE_LOAD_TIMEOUT_MS);assert.equal(imageLoadTimeout('900'),900);
  for(const bad of [0,-1,'abc',1.5])assert.throws(()=>imageLoadTimeout(bad));
  assert.equal(resolveImageRatioSource({sourceText:'原图比例'}).source,'natural');
  assert.equal(resolveImageRatioSource({sourceText:'图片框 1:1'}).source,'rendered-element');
  assert.equal(resolveImageRatioSource({sourceText:'显示比例 1:1'}).source,'rendered-content');
  assert.equal(resolveImageRatioSource({params:{ratioSource:'guess'}}).code,'image-ratio-source-unsupported');
});

test('nested scroll containers are restored and missing roots never pass',async()=>fixture('',async page=>{
  await page.evaluate(()=>{const root=document.querySelector('main');root.style.height='200px';root.style.overflow='auto';root.scrollTop=30;});
  const result=await check(page);
  assert.equal(result.status,'pass',JSON.stringify(result));
  assert.equal(await page.locator('main').evaluate(n=>n.scrollTop),30);
  const missing=await preparePrimaryImages({page,rootSelector:'.missing',timeoutMs:200});
  assert.equal(missing.structure.rootFound,false);
}));

test('loader code never writes lazy source attributes or decodes synthetic replacement URLs',async()=>{
  const source=await fs.readFile(new URL('../src/image-readiness.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/setAttribute\s*\(|\.(?:src|srcset)\s*=/);
});


test('runner config and checklist schema honor the same bounded image options',()=>{
  const previous=process.env.IMAGE_LOAD_TIMEOUT_MS, previousBlock=process.env.BLOCK_ID;
  try {
    process.env.BLOCK_ID='90001';
    process.env.IMAGE_LOAD_TIMEOUT_MS='730';assert.equal(loadConfig().imageLoadTimeoutMs,730);
    process.env.IMAGE_LOAD_TIMEOUT_MS='0';assert.throws(()=>loadConfig(),/positive integer/);
  } finally {
    if(previous===undefined)delete process.env.IMAGE_LOAD_TIMEOUT_MS;else process.env.IMAGE_LOAD_TIMEOUT_MS=previous;
    if(previousBlock===undefined)delete process.env.BLOCK_ID;else process.env.BLOCK_ID=previousBlock;
  }
  const spec={source:{fileKey:'fixture',nodeId:'1:1'},requirements:[{...requirement,params:{ratioSource:'automatic-pass'}}],overrides:[]};
  assert.ok(validateDesignSpec(spec).some(row=>JSON.stringify(row).includes('ratioSource')));
  spec.requirements[0].params.ratioSource='both';assert.deepEqual(validateDesignSpec(spec),[]);
});

test('failed scroll restoration cannot produce a pass',async()=>{
  const page=measuredImagePage([{ratio:1,centered:true}]),evaluate=page.evaluate;
  page.evaluate=(reader,...args)=>reader.name==='restoreImageScroll'?Promise.resolve(false):evaluate(reader,...args);
  const result=await check(page);
  assert.equal(result.status,'fail');assert.equal(result.reason.code,'image-load-scroll-restore-failed');
});

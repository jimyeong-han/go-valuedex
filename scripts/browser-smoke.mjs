const pages = await fetch('http://127.0.0.1:9222/json').then(response => response.json());
const page = pages.find(item => item.type === 'page' && item.url.includes('localhost:8765'));
if (!page) throw new Error('Open GO ValueDex with a Chrome remote-debugging session first.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once:true});
  socket.addEventListener('error', reject, {once:true});
});

let sequence = 0;
function command(method, params={}) {
  const id = ++sequence;
  socket.send(JSON.stringify({id, method, params}));
  return new Promise((resolve, reject) => {
    function receive(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', receive);
      if (message.error || message.result?.exceptionDetails) reject(new Error(message.error?.message || message.result.exceptionDetails.text));
      else resolve(message.result);
    }
    socket.addEventListener('message', receive);
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  return result?.result?.value;
}

await command('Emulation.clearDeviceMetricsOverride');
await command('Page.reload', {ignoreCache:true});
await new Promise(resolve => setTimeout(resolve, 2200));
await evaluate("selectPokemon('6:normal',false)");
const checks = [
  ['intuitive Pokédex name', await evaluate("document.title.includes('Pokémon GO 개체값·실전 도감')&&document.querySelector('.sidebar-head h1')?.textContent==='개체값·실전 도감'")],
  ['selected detail', await evaluate("document.querySelector('.hero-card h2')?.textContent === '리자몽'")],
  ['Charizard species-specific Elite moves', await evaluate("[...document.querySelectorAll('.move-line')].some(line=>line.textContent.includes('블라스트번')&&line.querySelector('.elite'))")],
  ['Metagross species-specific Elite moves', await evaluate("(()=>{selectPokemon(376,false);const elite=[...document.querySelectorAll('.move-line')].some(line=>line.textContent.includes('코멧펀치')&&line.querySelector('.elite'));selectPokemon(6,false);return elite})()")],
  ['Clefable shared move stays non-Elite', await evaluate("!moveLine(state.defaultByDex.get(36),'METEOR_MASH','charged','차지').includes('class=\"elite\"')")],
  ['Deoxys exposes four forms', await evaluate("(()=>{selectPokemon('386:defense',false);return state.byDex.get(386).length===4&&document.querySelectorAll('.form-chip').length===4&&state.selected.stats.attack===144&&state.selected.stats.defense===330})()")],
  ['Deoxys Defense PvP mapping', await evaluate("state.selected.speciesKey==='386:defense'&&state.pvp.leagues.great['386:defense']?.speciesId==='deoxys_defense'")],
  ['form route survives hash navigation', await evaluate("(async()=>{navigateTo('487:origin');await new Promise(resolve=>setTimeout(resolve,80));return new URLSearchParams(location.hash.slice(1)).get('pokemon')==='487:origin'&&state.selected.speciesKey==='487:origin'&&document.querySelector('.hero-card h2').textContent.includes('오리진')})()")],
  ['legacy numeric route resolves default form', await evaluate("(()=>{selectPokemon(6,false);return state.selected.speciesKey==='6:normal'&&document.querySelector('.hero-card h2').textContent==='리자몽'})()")],
  ['regional evolution keeps form', await evaluate("(()=>{selectPokemon('19:alola',false);const target=state.selected.evolutions[0]?.speciesKey,shown=[...document.querySelectorAll('.evo-link')].some(button=>button.dataset.selectKey==='20:alola');selectPokemon(6,false);return target==='20:alola'&&shown})()")],
  ['gender forms are labelled explicitly', await evaluate("(()=>{selectPokemon('593:normal',false);const labels=[...document.querySelectorAll('.form-chip')].map(button=>button.textContent);selectPokemon(6,false);return labels.some(label=>label.includes('수컷'))&&labels.some(label=>label.includes('암컷'))})()")],
  ['IV result', await evaluate("document.querySelector('#ivResult h4')?.textContent.includes('슈퍼리그')")],
  ['attack slider', await evaluate("(()=>{const e=document.querySelector('#iv-attack');e.value=15;e.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelector('#appraisalPercent').textContent.startsWith('35/45')})()")],
  ['Max mode', await evaluate("(()=>{document.querySelector('[data-mode=max]').click();return !document.querySelector('#maxToggle').hidden&&document.querySelector('#ivResult h4').textContent.includes('확인')})()")],
  ['Max eligibility', await evaluate("(()=>{const e=document.querySelector('#maxEligible');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelector('#ivResult h4').textContent.includes('맥스 공격수')})()")],
  ['Gigantamax-only eligibility', await evaluate("(()=>{selectPokemon(143,false);document.querySelector('[data-mode=max]').click();const e=document.querySelector('#maxEligible'),enabled=!e.disabled;e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));const supported=!document.querySelector('#ivResult h4').textContent.includes('미지원')&&document.querySelector('.transform-grid').textContent.includes('거다이맥스');selectPokemon(6,false);return enabled&&supported})()")],
  ['Korean form search', await evaluate("(()=>{const e=document.querySelector('#searchInput');e.value='어택폼';e.dispatchEvent(new Event('input',{bubbles:true}));return [...document.querySelectorAll('[data-select-key]')].some(button=>button.dataset.selectKey==='386:attack')})()")],
  ['Korean search', await evaluate("(()=>{const e=document.querySelector('#searchInput');e.value='뮤츠';e.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelector('#resultCount').textContent==='1개 폼'&&document.querySelector('#pokemonList').textContent.includes('뮤츠')})()")],
  ['no load error', await evaluate("!document.querySelector('#detailPanel').textContent.includes('데이터 로드 실패')")],
  ['battle utility core fixture', await evaluate("(()=>{selectPokemon('376:normal',false);return document.querySelector('.utility-pill')?.textContent==='핵심 실전용'&&document.querySelector('.utility-summary')?.textContent.includes('마스터리그')})()")],
  ['battle utility conditional fixture', await evaluate("(()=>{selectPokemon('68:normal',false);return document.querySelector('.utility-pill')?.textContent==='조건부 실전용'})()")],
  ['collection and evolution candidate fixture', await evaluate("(()=>{selectPokemon('129:normal',false);const summary=document.querySelector('.utility-summary')?.textContent||'';return document.querySelector('.utility-pill')?.textContent==='수집·관상 중심'&&summary.includes('진화 후 실전 후보')&&summary.includes('갸라도스')})()")],
  ['unobtainable battle form is reference only', await evaluate("(()=>{selectPokemon('890:eternamax',false);return document.querySelector('.utility-pill')?.textContent==='수집·관상 중심'&&document.querySelector('.utility-summary')?.textContent.includes('플레이어 보유')})()")],
  ['Shadow and purification preview fixture', await evaluate("(()=>{state.ivs={attack:10,defense:10,stamina:10};state.level=20;selectPokemon('1:normal',false);document.querySelector('[data-condition=shadow]').click();const text=document.querySelector('#scenarioCompare')?.textContent||'';return state.condition==='shadow'&&text.includes('10/10/10 · Lv.20')&&text.includes('12/12/12 · Lv.25')&&text.includes('590')&&text.includes('761')&&text.includes('3,000')&&text.includes('화풀이')&&text.includes('은혜갚기')&&document.querySelector('#statusHint').textContent.includes('12,000 별의모래 · 사탕 30')})()")],
  ['Shadow disables Max transformation', await evaluate("document.querySelector('#transformationGrid')?.textContent.includes('맥스배틀 사용 불가')")],
  ['Apex purification move fixture', await evaluate("(()=>{selectPokemon('249:normal',false);document.querySelector('[data-condition=shadow]').click();const apex=document.querySelector('#apexShadow');apex.checked=true;apex.dispatchEvent(new Event('change',{bubbles:true}));const text=document.querySelector('#scenarioCompare')?.textContent||'';return text.includes('APEX 정화')&&text.includes('5,000')&&text.includes('에어로블라스트+')&&text.includes('에어로블라스트++')})()")],
  ['Purified direct input does not apply +2 again', await evaluate("(()=>{state.ivs={attack:14,defense:13,stamina:15};state.level=20;selectPokemon('1:normal',false);document.querySelector('[data-condition=purified]').click();return state.condition==='purified'&&document.querySelector('#appraisalPercent').textContent.startsWith('42/45')&&document.querySelector('#ivResult .explanation').textContent.includes('+2')&&document.querySelector('#scenarioCompare').hidden})()")],
  ['ineligible form disables Shadow controls', await evaluate("(()=>{selectPokemon('386:defense',false);return document.querySelector('[data-condition=shadow]').disabled&&document.querySelector('[data-condition=purified]').disabled})()")],
  ['Gold Bottle Cap CP warning fixture', await evaluate("(()=>{state.ivs={attack:0,defense:15,stamina:15};state.level=45.5;selectPokemon('184:normal',false);const cap=document.querySelector('#trainingCap');cap.value='gold';cap.dispatchEvent(new Event('change',{bubbles:true}));const buddy=document.querySelector('#trainingBuddy');buddy.checked=true;buddy.dispatchEvent(new Event('change',{bubbles:true}));const attack=document.querySelector('#training-attack');attack.value=1;attack.dispatchEvent(new Event('input',{bubbles:true}));const text=document.querySelector('#scenarioCompare')?.textContent||'';return text.includes('0/15/15 · Lv.45.5')&&text.includes('1/15/15 · Lv.45.5')&&text.includes('CP 1,499 → 1,512')&&text.includes('CP 1,500 제한을 넘습니다')&&document.querySelector('.training-source').textContent.includes('HOME 전송 불가')})()")],
  ['Silver Bottle Cap locks other stats', await evaluate("(()=>{const cap=document.querySelector('#trainingCap');cap.value='silver';cap.dispatchEvent(new Event('change',{bubbles:true}));return !document.querySelector('#silverStats').hidden&&!document.querySelector('#training-attack').disabled&&document.querySelector('#training-defense').disabled&&document.querySelector('#training-stamina').disabled})()")],
  ['scenario status resets on species change', await evaluate("(()=>{selectPokemon('1:normal',false);document.querySelector('[data-condition=shadow]').click();selectPokemon('376:normal',false);return state.condition==='normal'&&document.querySelector('[data-condition=normal]').classList.contains('active')})()")],
];

await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
await evaluate("(()=>{state.ivs={attack:0,defense:15,stamina:15};state.level=45.5;selectPokemon('184:normal',false);document.querySelector('#trainingPlanner').open=true;return true})()")
checks.push(
  ['mobile viewport', await evaluate("innerWidth===390")],
  ['mobile no horizontal overflow', await evaluate("document.documentElement.scrollWidth<=innerWidth")],
  ['mobile detail routing', await evaluate("getComputedStyle(document.querySelector('.dex-sidebar')).display==='none'&&getComputedStyle(document.querySelector('#detailPanel')).display!=='none'")],
  ['mobile status targets are touch-sized', await evaluate("document.querySelector('[data-condition=normal]').getBoundingClientRect().height>=44&&document.querySelector('#trainingPlanner summary').getBoundingClientRect().height>=44")],
);

for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
socket.close();
if (checks.some(([, passed]) => !passed)) process.exitCode = 1;

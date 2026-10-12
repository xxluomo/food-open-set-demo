const LABELS = {
  pizza: '披萨', hamburger: '汉堡', sushi: '寿司', ramen: '拉面',
  fried_rice: '炒饭', caesar_salad: '凯撒沙拉', chocolate_cake: '巧克力蛋糕',
  ice_cream: '冰淇淋', tacos: '塔可', steak: '牛排',
  pho: '越南河粉', red_velvet_cake: '红丝绒蛋糕', french_fries: '法式薯条',
  peking_duck: '北京烤鸭', breakfast_burrito: '早餐卷饼'
};
const $ = id => document.getElementById(id);
const percent = v => `${(v * 100).toFixed(2)}%`;
const label = name => LABELS[name] || name.replaceAll('_', ' ');
let summary = null;
let sampleScores = null;
let imageData = null;
let prediction = null;
let selectedSample = null;
let activeMethod = 'max_cosine';

function status(message, error=false) {
  const el = $('status'); el.textContent = message; el.classList.toggle('error', error);
}

function setPreview(data, sample=null) {
  imageData = data; selectedSample = sample; prediction = null;
  $('preview').src = data; $('preview').hidden = false; $('drop-empty').hidden = true;
  $('run-button').disabled = false;
  $('result-placeholder').hidden = false; $('result-content').hidden = true;
  document.querySelectorAll('.sample').forEach(b => b.classList.toggle('active', b === sample));
  $('sample-truth').textContent = sample ? `样例真实类别：${label(sample.dataset.actual)}（${sample.dataset.role === 'known' ? '已知' : '未知'}）` : '已选择本地图片';
  status('样例已就绪。点击“查看已计算的结果”。');
}

function chooseSample(button) {
  setPreview(`./assets/${button.dataset.file}`, button);
}

function threshold(method) {
  return Number($(method === 'max_cosine' ? 'cosine-slider' : 'softmax-slider').value);
}

function updateDecisions() {
  if (!prediction) return;
  const cKnown = prediction.max_cosine >= threshold('max_cosine');
  const sKnown = prediction.max_softmax >= threshold('max_softmax');
  const render = (id, known, score, tau, secondary=false) => {
    const card = $(id+'-card');
    card.classList.toggle('rejected', !known); card.classList.toggle('secondary', known && secondary);
    $(id+'-decision').textContent = known ? `接受 · ${label(prediction.predicted)}` : '拒识 · 未知菜品';
    $(id+'-value').textContent = `${score.toFixed(6)} ${known ? '≥' : '<'} ${tau.toFixed(6)}`;
  };
  render('cosine', cKnown, prediction.max_cosine, threshold('max_cosine'));
  render('softmax', sKnown, prediction.max_softmax, threshold('max_softmax'), true);
  $('cosine-threshold').textContent = threshold('max_cosine').toFixed(6);
  $('softmax-threshold').textContent = threshold('max_softmax').toFixed(6);
  if (selectedSample) {
    const truthKnown = selectedSample.dataset.role === 'known';
    const quality = truthKnown ? (cKnown ? '已知类已接受' : '已知类被误拒') : (cKnown ? '未知类被错收' : '未知类已拒绝');
    $('predicted-note').textContent = `样例真实类别：${label(selectedSample.dataset.actual)} · 余弦方案：${quality}`;
  }
}

function rankRows(scores) {
  const list = $('rank-list'); list.replaceChildren();
  scores.forEach(row => {
    const item = document.createElement('div'); item.className='rank-row';
    const name=document.createElement('span'); name.className='name'; name.textContent=label(row.name);
    const track=document.createElement('span'); track.className='rank-track';
    const bar=document.createElement('i'); bar.style.width=`${Math.max(.5,row.softmax*100)}%`; track.append(bar);
    const value=document.createElement('span'); value.className='value'; value.textContent=`${(row.softmax*100).toFixed(1)}%`;
    item.append(name,track,value); list.append(item);
  });
}

function runInference() {
  if (!selectedSample || !sampleScores) return;
  const data = sampleScores[selectedSample.dataset.file];
  if (!data) return status('样例分数文件缺失。', true);
  prediction = data;
  $('result-placeholder').hidden = true;
  $('result-content').hidden = false;
  $('predicted-name').textContent = `${label(data.predicted)}  /  ${data.predicted}`;
  $('device-tag').textContent = '预先计算的真实结果';
  rankRows(data.scores);
  updateDecisions();
  status('样例分析完成。移动阈值滑块，可以比较两种拒识方案。');
}

function setOfficialThresholds() {
  if (!summary) return;
  $('cosine-slider').value=summary.validation.max_cosine.threshold;
  $('softmax-slider').value=summary.validation.max_softmax.threshold;
  $('cosine-threshold').textContent=threshold('max_cosine').toFixed(6);
  $('softmax-threshold').textContent=threshold('max_softmax').toFixed(6);
  updateDecisions();
}

function metricTable() {
  const c=summary.formal.max_cosine, s=summary.formal.max_softmax;
  for (const [id,field] of [['known','known_accept_rate'],['unknown','unknown_reject_rate'],['balanced','balanced_accuracy'],['auc','auroc']]) {
    $( `m-${id}-c`).textContent=id==='auc'?c[field].toFixed(4):percent(c[field]);
    $( `m-${id}-s`).textContent=id==='auc'?s[field].toFixed(4):percent(s[field]);
  }
  selectMetric(activeMethod);
}

function selectMetric(method) {
  activeMethod=method;
  const isCos=method==='max_cosine', data=summary.formal[method];
  $('tab-cosine').classList.toggle('active',isCos); $('tab-softmax').classList.toggle('active',!isCos);
  $('tab-cosine').setAttribute('aria-selected',String(isCos)); $('tab-softmax').setAttribute('aria-selected',String(!isCos));
  $('feature-reject').textContent=percent(data.unknown_reject_rate);
  $('feature-threshold').textContent=summary.validation[method].threshold.toFixed(6);
  $('feature-copy').textContent=isCos?'对外观陌生的菜品，模型能够在固定阈值下主动输出“未知”。':'softmax 对候选类别内部排序敏感；在本次测试中，未知拒绝率低于余弦方案。';
  document.querySelectorAll('.metric-table td').forEach(cell=>cell.classList.remove('highlight'));
  document.querySelectorAll(`.metric-table td[id$="-${isCos?'c':'s'}"]`).forEach(cell=>cell.classList.add('highlight'));
}

function axes(x0,y0,w,h,xlabels,ylabels) {
  let html=`<line x1="${x0}" y1="${y0+h}" x2="${x0+w}" y2="${y0+h}" stroke="#8ca79a"/><line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0+h}" stroke="#8ca79a"/>`;
  for (let i=0;i<=4;i++) {
    const x=x0+i*w/4,y=y0+h-i*h/4;
    html+=`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0+h}" stroke="#eaf0eb"/><line x1="${x0}" y1="${y}" x2="${x0+w}" y2="${y}" stroke="#eaf0eb"/>`;
    html+=`<text x="${x}" y="${y0+h+22}" text-anchor="middle" fill="#6d8378" font-size="11">${xlabels[i]}</text><text x="${x0-10}" y="${y+4}" text-anchor="end" fill="#6d8378" font-size="11">${ylabels[i]}</text>`;
  }
  return html;
}

function drawDistribution() {
  const svg=$('distribution-chart'), d=summary.distribution, x0=49,y0=19,w=485,h=211;
  const max=Math.max(...d.known,...d.unknown)*1.12;
  let html=axes(x0,y0,w,h,[0,1,2,3,4].map(i=>(d.edges[0]+(d.edges.at(-1)-d.edges[0])*i/4).toFixed(2)),[0,1,2,3,4].map(i=>`${(max*i/4*100).toFixed(0)}%`));
  const n=d.known.length,bw=w/n;
  for(let i=0;i<n;i++){
    const x=x0+i*bw+.6;
    const uh=d.unknown[i]/max*h,kh=d.known[i]/max*h;
    html+=`<rect x="${x}" y="${y0+h-uh}" width="${bw-1.2}" height="${uh}" fill="#e1a274" opacity=".76"/><rect x="${x}" y="${y0+h-kh}" width="${bw-1.2}" height="${kh}" fill="#177d75" opacity=".69"/>`;
  }
  const tau=summary.validation.max_cosine.threshold;
  const tx=x0+(tau-d.edges[0])/(d.edges.at(-1)-d.edges[0])*w;
  html+=`<line x1="${tx}" x2="${tx}" y1="${y0}" y2="${y0+h}" stroke="#263f3b" stroke-width="2" stroke-dasharray="5 4"/><text x="${Math.min(tx+5,x0+w-85)}" y="${y0+14}" fill="#263f3b" font-size="11">阈值 ${tau.toFixed(3)}</text>`;
  svg.innerHTML=html;
}

function drawRoc() {
  const svg=$('roc-chart'),x0=49,y0=19,w=485,h=211;
  let html=axes(x0,y0,w,h,['0','.25','.50','.75','1'],['0','.25','.50','.75','1']);
  html+=`<path d="M ${x0} ${y0+h} L ${x0+w} ${y0}" fill="none" stroke="#bdcbc2" stroke-dasharray="6 5" stroke-width="1.5"/>`;
  for(const [method,color] of [['max_cosine','#177d75'],['max_softmax','#e09b69']]) {
    const d=summary.roc[method].map((p,i)=>`${i?'L':'M'} ${(x0+p.fpr*w).toFixed(1)} ${(y0+(1-p.tpr)*h).toFixed(1)}`).join(' ');
    html+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  svg.innerHTML=html;
}

function renderClasses() {
  const node=$('class-bars'); node.replaceChildren();
  summary.per_class.forEach(row=>{
    const item=document.createElement('div'); item.className='class-bar';
    const title=document.createElement('span'); title.textContent=label(row.name);
    const track=document.createElement('span'); track.className='track';
    const bar=document.createElement('i'); bar.style.width=`${(row.rate*100).toFixed(1)}%`; track.append(bar);
    const rate=document.createElement('strong'); rate.textContent=`${(row.rate*100).toFixed(1)}%`;
    item.append(title,track,rate); node.append(item);
  });
  const worst=summary.confusions[0];
  $('confusion-note').textContent=`最常见的未知类错收之一：${label(worst.actual)} → ${label(worst.predicted)}。各类别的拒绝率仅针对本次固定类别划分。`;
}

async function init() {
  try {
    const [r, samples]=await Promise.all([fetch('./summary.json'),fetch('./sample_scores.json')]);
    if(!r.ok || !samples.ok) throw Error('正式结果文件读取失败');
    summary=await r.json(); sampleScores=await samples.json();
    setOfficialThresholds();metricTable();drawDistribution();drawRoc();renderClasses();
  } catch(err) {status(`实验结果加载失败：${err.message}`,true);}
  document.querySelectorAll('.sample').forEach(b=>b.addEventListener('click',()=>chooseSample(b)));
  $('run-button').addEventListener('click',runInference);
  $('cosine-slider').addEventListener('input',updateDecisions);
  $('softmax-slider').addEventListener('input',updateDecisions);
  $('reset-threshold').addEventListener('click',setOfficialThresholds);
  $('tab-cosine').addEventListener('click',()=>selectMetric('max_cosine'));
  $('tab-softmax').addEventListener('click',()=>selectMetric('max_softmax'));
}
document.addEventListener('DOMContentLoaded',init);

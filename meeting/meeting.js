(()=>{
  const data={
    prepare:{label:'Before the call',time:'Ready',question:'Likely question: Is the payment webhook ready for production?',kicker:'OPEN WITH',topic:'Main point',answer:'“Testing is on track. I want to confirm the final staging check and Friday go-live date.”',source:'↳ Prepared from your notes, files and past calls'},
    call:{label:'Client',time:'10:00:00',question:'Where are we on the payment webhook? Is it ready to go live?',kicker:'SAY THIS',topic:'Status?',answer:'Testing finishes Friday. I’ll confirm the go-live date after the final staging check.',source:'↳ From your notes · “Webhook testing” · 4 Nov'},
    recap:{label:'After the call',time:'Draft',question:'Check this recap before anything is saved.',kicker:'TO DO',topic:'Confirm first',answer:'Send the final checklist today. Confirm Friday’s go-live date after staging.',source:'↳ AI-written draft · tick what is right, then save'}
  };
  const ids=['label','time','question','kicker','topic','answer','source'];
  const tabs=[...document.querySelectorAll('[data-demo]')];
  const panel=document.querySelector('.panel-wrap');
  function show(stage,scroll=false){
    const item=data[stage]||data.call;
    ids.forEach(id=>{const el=document.getElementById('demo-'+id);if(el)el.textContent=item[id]});
    document.querySelectorAll('.demo-tabs [data-demo]').forEach(b=>b.classList.toggle('active',b.dataset.demo===stage));
    const answer=document.querySelector('.answer-row'); if(answer)answer.hidden=stage!=='call';
    const live=document.querySelector('.live-dot'); if(live){live.textContent=stage==='call'?'LIVE':stage==='prepare'?'READY':'ENDED';live.style.opacity=stage==='call'?'1':'.65'}
    if(scroll&&panel)panel.scrollIntoView({behavior:'smooth',block:'center'});
  }
  tabs.forEach(b=>b.addEventListener('click',()=>show(b.dataset.demo,b.classList.contains('demo-jump'))));
  const help=document.getElementById('answer-button');
  if(help)help.addEventListener('click',()=>{
    help.disabled=true;help.classList.add('loading');help.textContent='Reading your notes…';
    setTimeout(()=>{document.getElementById('demo-answer').textContent='The webhook retry test passed. I’ll send the final go-live time after today’s staging check.';document.getElementById('demo-source').textContent='↳ From 2 notes · “Retry test” · Today';help.textContent='Answer updated ✓';help.classList.remove('loading');setTimeout(()=>{help.disabled=false;help.textContent='Help me answer →'},1800)},700);
  });
  let seconds=12;setInterval(()=>{const t=document.getElementById('call-timer');if(t){seconds++;t.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')}},1000);
  const reveal=[...document.querySelectorAll('.reveal')];
  if('IntersectionObserver'in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12});reveal.forEach(x=>io.observe(x))}else reveal.forEach(x=>x.classList.add('in'));
  show('call');
})();

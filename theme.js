// Light/dark theme. Runs before the page renders to avoid a light flash.
(function(){
  const key='rental-maker-theme';let saved=null;
  try{saved=localStorage.getItem(key);}catch{}
  const prefersDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme=saved==='dark'||(!saved&&prefersDark)?'dark':'light';
  document.addEventListener('DOMContentLoaded',()=>{
    const button=document.getElementById('themeToggle');if(!button)return;
    const update=()=>{const dark=document.documentElement.dataset.theme==='dark';button.textContent=dark?'Light mode':'Dark mode';button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');};
    button.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem(key,next);}catch{}update();});
    update();
  });
})();

'use strict';
// Browser-only replacement for the local server API, used by the public web version.
// app.js is unchanged: its /api/* requests are answered here from catalog.json and localStorage.
(function(){
  const LISTS_KEY='rental-maker-review-lists-v2'; // Old name kept so visitors' saved lists still load.
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const fail=message=>json({error:message},400);
  let catalogCache=null;
  async function loadCatalog(){if(!catalogCache){const r=await realFetch('catalog.json');if(!r.ok)throw Error('Catalog could not load');catalogCache=await r.json();}return catalogCache;}
  function readLists(){try{const v=JSON.parse(localStorage.getItem(LISTS_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
  function writeLists(lists){localStorage.setItem(LISTS_KEY,JSON.stringify(lists));}
  const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;

  // Same rules as validate() in server.py.
  async function validateList(data){
    if(!data||typeof data!=='object')throw Error('Invalid list');
    const name=String(data.project_name??'').trim();
    if(!name||name.length>200)throw Error('Enter a project name (up to 200 characters)');
    if(!validDate(data.start_date)||!validDate(data.end_date))throw Error('Choose rental start and end dates');
    if(data.end_date<data.start_date)throw Error('End date must be on or after start date');
    const lines=data.lines??[];
    if(!Array.isArray(lines)||lines.length>2000)throw Error('Invalid equipment lines');
    const cat=await loadCatalog(),known=new Map(cat.items.map(i=>[i.id,i])),suppliers=new Map(cat.suppliers.map(s=>[s.id,s.name]));
    const listType=data.list_type||'lights';
    if(!['camera','lights'].includes(listType))throw Error('Choose Camera or Lights');
    const compiler=String(data.compiler_name??'').trim();
    if(compiler.length>200)throw Error('Compiler name is too long');
    const seen=new Set(),checked=[];
    for(const line of lines){
      if(!line||typeof line!=='object'||!known.has(line.id))throw Error('Unknown equipment; update your list from the current catalog');
      const item=known.get(line.id),qty=line.quantity;
      if(!Number.isInteger(qty)||qty<1||qty>9999)throw Error('Quantity must be a whole number between 1 and 9999');
      const kind=line.list_type||equipmentType(item);
      if(!['camera','lights'].includes(kind))throw Error('Invalid equipment list type');
      if(seen.has(kind+'|'+item.id))throw Error('Duplicate equipment line');
      seen.add(kind+'|'+item.id);
      const notes=String(line.notes??'');if(notes.length>3000)throw Error('Line notes are too long');
      checked.push({...item,supplier_name:suppliers.get(item.supplier_id)||item.supplier_id,quantity:qty,notes,list_type:kind});
    }
    const notes=String(data.notes??'');if(notes.length>5000)throw Error('Project notes are too long');
    return {id:String(data.id||crypto.randomUUID()),project_name:name,start_date:data.start_date,end_date:data.end_date,notes,lines:orderedLines(checked),list_type:listType,compiler_name:compiler,manually_ordered:data.manually_ordered===true};
  }
  // Category order shared with ordering.py: stable within a category, categories by reference order.
  function orderedLines(lines){
    const groups=new Map();
    for(const l of lines){const k=[l.list_type,l.supplier_id,l.category,l.subcategory||''].join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);}
    return [...groups.values()].sort((a,b)=>(a[0].list_type<b[0].list_type?-1:a[0].list_type>b[0].list_type?1:0)||categoryRank(a[0])-categoryRank(b[0])).flat();
  }
  function base64ToBytes(s){const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
  // Reads the editable list embedded by this version (V2) or by the earlier web version (V1).
  async function importPdf(b64){
    let bytes;try{bytes=base64ToBytes(b64);}catch{throw Error('Invalid PDF upload');}
    if(bytes.length>3000000||new TextDecoder('latin1').decode(bytes.slice(0,4))!=='%PDF')throw Error('Choose a PDF under 3 MB');
    const text=new TextDecoder('latin1').decode(bytes);
    const v2=[...text.matchAll(/%RLM_LIST_V2 ([A-Za-z0-9+/=]+)/g)],v1=[...text.matchAll(/%RLM_PRESET_V1 ([A-Za-z0-9+/=]+)/g)];
    if(v2.length+v1.length!==1)throw Error('This PDF has no editable Rental List Maker data. Import a PDF exported by this app, or restore a JSON backup.');
    let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(base64ToBytes((v2[0]||v1[0])[1])));}catch{throw Error('Invalid editable PDF data');}
    let list;
    if(v2.length){if(payload.format!=='rental-list-maker'||payload.version!==2||!payload.list)throw Error('Invalid editable PDF data');list=payload.list;}
    else{if(payload.format!=='rental-list-maker-pdf-preset'||payload.version!==1||!payload.list)throw Error('Invalid editable PDF data');list={...payload.list,list_type:'lights',lines:(payload.list.lines||[]).map(l=>({...l,list_type:undefined}))};}
    const cat=await loadCatalog(),known=new Set(cat.items.map(i=>i.id)),missing=(list.lines||[]).filter(l=>!known.has(l?.id));
    if(missing.length)throw Error('Equipment is no longer in the catalog: '+missing.map(l=>String(l.name||l.id)).slice(0,3).join(', ')+'. Current draft kept.');
    return validateList({...list,id:null});
  }
  async function handle(path,method,body){
    if(path==='/api/catalog')return json(await loadCatalog());
    if(path==='/api/refresh')return method==='GET'?json({running:false,message:''}):fail('Catalog refresh is not available in the web version');
    if(path==='/api/lists'&&method==='GET')return json(readLists());
    const data=body?JSON.parse(body):{};
    if(path==='/api/lists'){const checked=await validateList(data);checked.updated_at=new Date().toISOString();writeLists([checked,...readLists().filter(l=>l.id!==checked.id)]);return json(checked);}
    if(path==='/api/lists/delete'){writeLists(readLists().filter(l=>l.id!==String(data.id||'')));return json({ok:true});}
    if(path==='/api/pdf'){const checked=await validateList(data);checked.lines=checked.lines.filter(l=>l.list_type===checked.list_type);if(!checked.lines.length)throw Error('Add equipment to the selected list');return new Response(window.makeRentalPdf(checked),{headers:{'Content-Type':'application/pdf'}});}
    if(path==='/api/import-pdf')return json(await importPdf(data.pdf||''));
    return json({error:'Not found'},404);
  }
  const realFetch=window.fetch.bind(window);
  // Inside a Claude artifact the frame cannot download files itself; hand PDFs and backups to the viewer's save prompt.
  if(window.claude?.use){
    const downloads=window.claude.use('downloads');
    try{delete window.showSaveFilePicker;window.showSaveFilePicker=undefined;}catch{}
    const nativeClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){
      if(!this.download||!this.href.startsWith('blob:'))return nativeClick.call(this);
      const filename=this.download,blob=realFetch(this.href).then(r=>r.blob());
      downloads.then(async d=>{
        if(!d)return nativeClick.call(this);
        try{await d.save({filename,data:await blob});}
        catch(e){if(e?.code!=='declined'){const t=document.getElementById('toast');if(t){t.textContent='Could not save the file here. Open the app in claude.ai or a browser and try again.';t.classList.add('show');}}}
      });
    };
  }
  window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
      try{return await handle(url.pathname,(init.method||'GET').toUpperCase(),init.body);}
      catch(e){return fail(e.message||'Operation failed');}
    }
    if(url.origin===location.origin&&url.pathname==='/category-order.json')return realFetch('category-order.json');
    return realFetch(input,init);
  };
})();

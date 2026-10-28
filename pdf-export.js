'use strict';
// Browser PDF export for the web version; mirrors pdf_export.py (A4, grouped Qty / Equipment / Notes).
function renderRentalPdf(data,spacers){
  const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'pt',format:'a4'});
  doc.addFileToVFS('RentalSans.ttf',window.rentalPdfFont);doc.addFont('RentalSans.ttf','RentalSans','normal');doc.setFont('RentalSans');
  doc.setProperties({title:data.project_name,author:'Rental List Maker'});
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),left=38,available=width-76;
  const label=data.list_type==='camera'?'Camera':'Lights';
  let y=51;doc.setTextColor('#202020');
  function text(value,size=9,leading=13,gap=0){doc.setFontSize(size);for(const line of doc.splitTextToSize(String(value),available)){if(y>height-55){doc.addPage();y=51;}doc.text(line,left,y);y+=leading;}y+=gap;}
  const suppliers=[...new Set(data.lines.map(l=>l.supplier_name))];
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Tallinn',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).formatToParts(new Date()),part=t=>parts.find(p=>p.type===t)?.value||'';
  text(label.toUpperCase()+' EQUIPMENT BOOKING REQUEST',9,14,10);text(data.project_name,21,27,12);
  text('Rental: '+data.start_date+' to '+data.end_date);text('Compiler: '+(data.compiler_name||'Not specified'));text('Supplier: '+suppliers.join(', '));
  text('Generated: '+part('day')+' '+part('month')+' '+part('year')+' '+part('hour')+':'+part('minute')+' '+part('timeZoneName'),9,13,18);
  if(data.notes)text(data.notes,9,13,14);
  const groups=new Map();for(const l of data.lines){const k=[l.supplier_name,l.category,l.subcategory||''].join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);}
  const body=[];let g=0;
  for(const lines of groups.values()){
    const f=lines[0];
    // A spacer pushes a heading that would sit alone at a page bottom onto the next page.
    if(spacers.has(g))body.push([{content:'',colSpan:3,styles:{minCellHeight:spacers.get(g),lineWidth:0,cellPadding:0}}]);
    body.push([{content:(suppliers.length>1?f.supplier_name+' / ':'')+f.category+(f.subcategory?' / '+f.subcategory:''),colSpan:3,styles:{fillColor:'#f2f2f2'},group:g++}]);
    for(const l of lines)body.push([String(l.quantity),l.name,l.notes||'']);
  }
  const seen=new Map();
  doc.autoTable({startY:y,tableWidth:507,margin:{left:38,right:38,top:42,bottom:42},head:[['QTY','EQUIPMENT','NOTES']],body,theme:'plain',showHead:'everyPage',rowPageBreak:'auto',
    styles:{font:'RentalSans',fontStyle:'normal',fontSize:9,textColor:'#202020',cellPadding:6,lineColor:'#dddddd',lineWidth:{bottom:.3},valign:'top',overflow:'linebreak'},
    headStyles:{fontStyle:'normal',fillColor:'#ffffff',lineColor:'#333333',lineWidth:{bottom:1}},
    columnStyles:{0:{cellWidth:40},1:{cellWidth:290},2:{cellWidth:177}},
    didDrawCell:d=>{if(d.section==='body'&&d.column.index===0&&!seen.has(d.row.index))seen.set(d.row.index,{page:d.pageNumber??d.doc.internal.getCurrentPageInfo().pageNumber,y:d.cell.y,group:d.row.raw[0]?.group})}});
  y=doc.lastAutoTable.finalY+23;text('Booking request only. Availability and final terms to be confirmed by the rental house.',9,14);
  const count=doc.getNumberOfPages(),footer='Rental List Maker  /  '+(data.project_name.length<=65?data.project_name:data.project_name.slice(0,64).trimEnd()+'…');
  for(let page=1;page<=count;page++){doc.setPage(page);doc.setFontSize(8);doc.setTextColor('#777777');doc.text(footer,38,height-23);doc.text('Page '+page+' of '+count,width-38,height-23,{align:'right'});}
  // Headings whose first item landed on a later page.
  const orphans=new Map();
  for(const [index,info] of seen){if(info.group===undefined)continue;const next=seen.get(index+1);if(next&&next.page>info.page)orphans.set(info.group,height-42-info.y-1);}
  return {doc,orphans};
}
window.makeRentalPdf=function(data){
  const spacers=new Map();let result;
  for(let pass=0;pass<6;pass++){result=renderRentalPdf(data,spacers);let changed=false;for(const [g,h] of result.orphans)if(!spacers.has(g)&&h>0){spacers.set(g,h);changed=true;}if(!changed)break;}
  const doc=result.doc;
  // Embed the editable list so Import PDF can reopen it.
  const payload={format:'rental-list-maker',version:2,list:{...data,id:null}};
  const bytes=new TextEncoder().encode(JSON.stringify(payload));let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return new Blob([doc.output('arraybuffer'),'\n%RLM_LIST_V2 '+btoa(binary)+'\n'],{type:'application/pdf'});
};

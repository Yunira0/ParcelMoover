import{i as e,l as t,r as n}from"./api-YN7heKRk.js";import{t as r}from"./eye-off-CWOGcnv2.js";import{t as i}from"./eye-CQkpDcIe.js";import{t as a}from"./package-check-CkLeBuz3.js";import{t as o}from"./printer-DM2eKH4t.js";import{t as s}from"./Table-WKaIfQfN.js";import{l as c,o as l}from"./nepaliDate-HhBw2s26.js";import{T as u,_ as d,_t as f,bt as p,f as m,gt as h,it as g,m as _,n as v,q as y,r as b,rt as x,st as S}from"./index-B3aQwLM-.js";import{a as C}from"./users.service-BGG-jovR.js";/* empty css              */import{t as w}from"./PageHeader-CW9AeNqw.js";import{t as T}from"./format-CTpA8Lhl.js";var E=t(e(),1),D=n(),O=({icon:e,label:t,value:n,to:r})=>{let i=(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(`div`,{className:`stat-icon-wrapper`,children:(0,D.jsx)(e,{className:`stat-icon`,size:24})}),(0,D.jsxs)(`div`,{className:`stat-content`,children:[(0,D.jsx)(`span`,{className:`stat-label`,children:t}),(0,D.jsx)(`span`,{className:`stat-value`,children:n})]})]});return r?(0,D.jsx)(p,{to:r,className:`stat-card stat-card-link`,"aria-label":`${t}: ${n} — view details`,children:i}):(0,D.jsx)(`div`,{className:`stat-card`,children:i})},k=e=>e.toLocaleString(void 0,{maximumFractionDigits:0});function A(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}var j=`
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; color: #000; font-family: Arial, sans-serif; padding: 10mm; }

  .sheet-header {
    align-items: flex-start;
    border-bottom: 2px solid #000;
    display: flex;
    justify-content: space-between;
    padding-bottom: 4mm;
  }

  .brand { font-size: 18px; font-weight: 800; letter-spacing: 0.3px; }
  .doc-title { color: #444; font-size: 11px; letter-spacing: 1px; margin-top: 2px; text-transform: uppercase; }
  .sheet-no { font-family: 'Courier New', monospace; font-size: 16px; font-weight: 900; letter-spacing: 1px; text-align: right; }
  .sheet-date { color: #444; font-size: 10px; margin-top: 2px; text-align: right; }

  .meta-grid {
    border-bottom: 1px solid #000;
    display: flex;
    flex-wrap: wrap;
    gap: 3mm 8mm;
    padding: 3mm 0;
  }

  .meta-item { min-width: 30mm; }
  .meta-label { color: #666; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  .meta-value { font-size: 11px; font-weight: 700; margin-top: 1px; }

  table { border-collapse: collapse; margin-top: 4mm; width: 100%; }
  th, td { border: 1px solid #000; font-size: 9px; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 8px; letter-spacing: 0.4px; text-transform: uppercase; }
  td.num { text-align: right; white-space: nowrap; }
  td.mono { font-family: 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
  td small { color: #444; display: block; font-size: 8px; margin-top: 1px; }
  td.sign { min-width: 22mm; }
  tr { break-inside: avoid; }

  tfoot td { background: #eee; font-weight: 700; }

  .signatures {
    display: flex;
    gap: 16mm;
    justify-content: space-between;
    margin-top: 14mm;
  }

  .signature { border-top: 1px solid #000; flex: 1; font-size: 9px; padding-top: 2mm; text-align: center; text-transform: uppercase; }

  @media print {
    @page { size: A4 portrait; margin: 8mm; }
    body { padding: 0; }
  }
`;function M(e,t){let n=window.open(``,`_blank`,`width=900,height=650`);if(!n){alert(`Please allow popups for this site to print the run sheet.`);return}let r=e.parcels.map((e,n)=>`
    <tr>
      <td class="num">${n+1}</td>
      <td class="mono">${A(e.trackingId)}</td>
      <td>${A(e.receiverName)}<small>${A(e.receiverPhone)}</small></td>
      <td>${A(e.address||e.destination||`-`)}</td>
      <td class="num">${e.pieces}</td>
      <td class="num">${e.codAmount>0?k(e.codAmount):`-`}</td>
      <td>${A(e.vendorName||`-`)}</td>
      <td>${A(t[e.status]??e.status)}</td>
      <td class="sign"></td>
    </tr>`).join(``),i=[[`Rider`,e.rider.name],[`Phone`,e.rider.phone||`-`],[`Vehicle`,e.rider.vehicleNo||`-`],[`Hub`,e.rider.hub||`-`],[`Total Items`,String(e.totalItems)],[`Delivered`,String(e.deliveredItems)],[`Failed`,String(e.failedItems)],[`Total COD`,`NPR ${k(e.totalCod)}`]];n.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Run Sheet ${A(e.sheetNo)} — ParcelMoover</title>
  <style>${j}</style>
</head>
<body>
  <header class="sheet-header">
    <div>
      <div class="brand">ParcelMoover</div>
      <div class="doc-title">Rider Run Sheet</div>
    </div>
    <div>
      <div class="sheet-no">${A(e.sheetNo)}</div>
      <div class="sheet-date">${A(l(e.createdAt))} · ${A(c(e.createdAt,!0))}</div>
    </div>
  </header>

  <div class="meta-grid">
    ${i.map(([e,t])=>`
    <div class="meta-item">
      <div class="meta-label">${A(e)}</div>
      <div class="meta-value">${A(t)}</div>
    </div>`).join(``)}
  </div>

  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Tracking ID</th>
        <th>Receiver</th>
        <th>Delivery Address</th>
        <th>Pcs</th>
        <th>COD</th>
        <th>Vendor</th>
        <th>Status</th>
        <th>Signature</th>
      </tr>
    </thead>
    <tbody>${r}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Totals</td>
        <td class="num">${e.parcels.reduce((e,t)=>e+t.pieces,0)}</td>
        <td class="num">${k(e.totalCod)}</td>
        <td colspan="3">${e.totalItems} parcel${e.totalItems===1?``:`s`}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="signature">Prepared By</div>
    <div class="signature">Rider (${A(e.rider.name)})</div>
    <div class="signature">Verified By</div>
  </div>

<script>
  window.addEventListener('load', function() {
    window.print();
    window.addEventListener('afterprint', function() { window.close(); });
  });
<\/script>
</body>
</html>`),n.document.close()}var N=``,P={pickup_ordered:`Pickup Ordered`,rider_assigned:`Rider Assigned`,picked_up:`Pickup Completed`,arrived:`Arrived at Origin`,ready_to_deliver:`Ready to Deliver`,sent_for_delivery:`Sent for Delivery`,oov:`Transit`,dispatched:`In Transit`,arrived_at_branch:`Arrived at Destination`,hold:`Hold`,loss_and_damage:`Loss and Damage`,delivered:`Delivered`,partially_delivered:`Partially Delivered`,failed_pickup:`Failed Pickup`,failed_delivery:`Failed Delivery`,cancelled:`Cancelled`,follow_up:`Follow Up`,ready_to_return:`Ready to Return`,sent_to_vendor:`Sent to Vendor`,returned_to_vendor:`Returned to Vendor`},F=e=>e===`delivered`?`success`:e===`partially_delivered`?`warning`:[`failed_delivery`,`failed_pickup`,`loss_and_damage`].includes(e)?`danger`:e===`cancelled`?`neutral`:[`sent_for_delivery`,`ready_to_deliver`].includes(e)?`info`:`warning`,I=()=>new Date(Date.now()+345*60*1e3).toISOString().slice(0,10),L=({iso:e})=>e?(0,D.jsxs)(`div`,{className:`runsheet-datetime`,children:[(0,D.jsx)(`span`,{children:l(e)}),(0,D.jsx)(`small`,{children:c(e,!0)})]}):(0,D.jsx)(D.Fragment,{children:`-`}),R=[{header:`ID`,accessor:e=>`#${e.orderNumber}`,width:`70px`},{header:`TRACKING ID`,accessor:e=>(0,D.jsx)(p,{to:`/orders/track/${e.trackingId}`,className:`tracking-id-link`,children:e.trackingId}),width:`160px`,className:`runsheet-tracking-cell`},{header:`RECEIVER`,accessor:e=>(0,D.jsxs)(`div`,{className:`runsheet-party-cell`,children:[(0,D.jsx)(`span`,{children:e.receiverName}),(0,D.jsx)(`small`,{children:e.receiverPhone})]}),width:`200px`},{header:`DELIVERY ADDRESS`,accessor:e=>e.address||e.destination||`-`},{header:`PIECES`,accessor:e=>e.pieces,width:`80px`},{header:`COD`,accessor:e=>e.codAmount>0?T(e.codAmount,0):`-`,width:`110px`},{header:`VENDOR`,accessor:e=>e.vendorName||`-`,width:`160px`},{header:`STATUS`,accessor:e=>(0,D.jsx)(d,{tone:F(e.status),children:P[e.status]??e.status}),width:`160px`}],z=({sheet:e})=>{let t=E.useRef(null);return(0,E.useEffect)(()=>{t.current?.scrollIntoView({behavior:`smooth`,block:`nearest`})},[e.id]),(0,D.jsxs)(`section`,{ref:t,className:`runsheet-rider-card`,children:[(0,D.jsxs)(`header`,{className:`runsheet-rider-header`,children:[(0,D.jsxs)(`div`,{className:`runsheet-rider-identity`,children:[(0,D.jsx)(`div`,{className:`runsheet-rider-avatar`,children:(0,D.jsx)(h,{size:20})}),(0,D.jsxs)(`div`,{className:`runsheet-rider-info`,children:[(0,D.jsx)(`h2`,{children:e.sheetNo}),(0,D.jsxs)(`div`,{className:`runsheet-rider-meta`,children:[(0,D.jsxs)(`span`,{children:[(0,D.jsx)(h,{size:13}),` `,e.rider.name]}),e.rider.phone&&(0,D.jsxs)(`span`,{children:[(0,D.jsx)(x,{size:13}),` `,e.rider.phone]}),e.rider.vehicleNo&&(0,D.jsxs)(`span`,{children:[(0,D.jsx)(y,{size:13}),` `,e.rider.vehicleNo]}),e.rider.hub&&(0,D.jsxs)(`span`,{children:[(0,D.jsx)(S,{size:13}),` `,e.rider.hub]})]})]})]}),(0,D.jsxs)(`div`,{className:`runsheet-rider-totals`,children:[(0,D.jsxs)(d,{tone:`info`,variant:`solid`,children:[e.outItems,` out`]}),(0,D.jsxs)(d,{tone:`success`,variant:`solid`,children:[e.deliveredItems,` delivered`]}),e.failedItems>0&&(0,D.jsxs)(d,{tone:`danger`,variant:`solid`,children:[e.failedItems,` failed`]}),(0,D.jsxs)(d,{tone:`warning`,variant:`solid`,children:[`COD `,T(e.totalCod,0)]})]})]}),(0,D.jsx)(s,{columns:R,data:e.parcels,selectable:!1,minWidth:`1010px`,tableClassName:`runsheet-table`,emptyMessage:`This run sheet has no parcels.`})]})},B=()=>{let[e,t]=(0,E.useState)([]),[n,c]=(0,E.useState)({totalSheets:0,totalItems:0,deliveredItems:0,outItems:0,totalCod:0}),[l,p]=(0,E.useState)([]),[h,x]=(0,E.useState)(N),[S,k]=(0,E.useState)(I),[A,j]=(0,E.useState)(``),[F,R]=(0,E.useState)(``),[B,V]=(0,E.useState)(!0),[H,U]=(0,E.useState)(``);(0,E.useEffect)(()=>{(async()=>{try{let e=await C();e?.success&&Array.isArray(e.data)&&p(e.data.filter(e=>e.status===`active`))}catch{}})()},[]);let W=(0,E.useCallback)(async()=>{V(!0);try{let e=await m({riderId:h||void 0,date:S||void 0});e?.success&&e.data&&(t(e.data.sheets),c(e.data.summary),U(``))}catch{U(`Failed to load run sheets. Showing the last loaded data, if any.`)}finally{V(!1)}},[h,S]);(0,E.useEffect)(()=>{W()},[W]),(0,E.useEffect)(()=>_(W),[W]);let G=(0,E.useMemo)(()=>e.map((e,t)=>({...e,sn:t+1})),[e]),K=e.find(e=>e.id===A),q=e.find(e=>e.id===F),J=[{header:`S.N.`,accessor:e=>e.sn,width:`60px`},{header:`RUNSHEET ID`,accessor:e=>(0,D.jsx)(`button`,{type:`button`,className:`runsheet-id-link`,onClick:()=>R(e.id),children:e.sheetNo}),width:`210px`,className:`runsheet-tracking-cell`},{header:`CREATED`,accessor:e=>(0,D.jsx)(L,{iso:e.createdAt}),width:`120px`},{header:`UPDATED`,accessor:e=>(0,D.jsx)(L,{iso:e.updatedAt}),width:`120px`},{header:`VEHICLE`,accessor:e=>e.rider.vehicleNo||`N/A`,width:`110px`},{header:`DRIVER`,accessor:e=>(0,D.jsxs)(`div`,{className:`runsheet-party-cell`,children:[(0,D.jsx)(`span`,{children:e.rider.name}),(0,D.jsx)(`small`,{children:e.rider.phone})]}),width:`180px`},{header:`HUB`,accessor:e=>e.rider.hub||`-`,width:`130px`},{header:`TOTAL ITEMS`,accessor:e=>(0,D.jsx)(`strong`,{children:e.totalItems}),width:`100px`},{header:`DELIVERED ITEMS`,accessor:e=>e.totalItems>0&&e.deliveredItems===e.totalItems?(0,D.jsx)(d,{tone:`success`,children:e.deliveredItems}):(0,D.jsx)(`strong`,{children:e.deliveredItems}),width:`130px`},{header:`COD`,accessor:e=>e.totalCod>0?T(e.totalCod,0):`-`,width:`110px`},{header:`PARCELS`,accessor:e=>(0,D.jsx)(u,{variant:`outline`,size:`sm`,onClick:()=>j(t=>t===e.id?``:e.id),children:A===e.id?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(r,{size:14}),` Hide`]}):(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(i,{size:14}),` View`]})}),width:`110px`}];return(0,D.jsxs)(`div`,{className:`runsheet-container`,children:[(0,D.jsx)(w,{title:`Rider Run Sheet`,subtitle:`Every hand-off batch sent out for delivery - one numbered sheet per rider trip.`}),(0,D.jsxs)(`div`,{className:`runsheet-stats`,children:[(0,D.jsx)(O,{icon:g,label:`Total Items`,value:n.totalItems}),(0,D.jsx)(O,{icon:y,label:`Sent for Delivery`,value:n.outItems}),(0,D.jsx)(O,{icon:a,label:`Delivered`,value:n.deliveredItems}),(0,D.jsx)(O,{icon:f,label:`COD on Sheets`,value:T(n.totalCod,0)})]}),(0,D.jsx)(`div`,{className:`runsheet-toolbar`,children:(0,D.jsxs)(`div`,{className:`runsheet-filters`,children:[(0,D.jsxs)(`div`,{className:`runsheet-filter-group`,children:[(0,D.jsx)(`label`,{className:`runsheet-filter-label`,children:`Rider`}),(0,D.jsx)(b,{options:[{id:N,label:`All Riders`},...l.map(e=>({id:e.id,label:e.name}))],value:h,onChange:x,placeholder:`All Riders`,searchPlaceholder:`Search rider by name...`,emptyMessage:`No active riders found.`})]}),(0,D.jsxs)(`div`,{className:`runsheet-filter-group`,children:[(0,D.jsx)(`label`,{className:`runsheet-filter-label`,children:`Date`}),(0,D.jsx)(v,{value:S,onChange:k,"aria-label":`Run sheet date`})]})]})}),H&&(0,D.jsx)(`p`,{className:`runsheet-error`,children:H}),(0,D.jsx)(s,{columns:J,data:G,selectable:!1,getRowClassName:e=>e.id===A?`runsheet-row-active`:``,loading:B&&G.length===0,loadingMessage:`Loading run sheets...`,emptyMessage:`No run sheets on ${S}.`,minWidth:`1420px`,tableClassName:`runsheet-table`}),K&&(0,D.jsx)(z,{sheet:K}),q&&(0,D.jsx)(`div`,{className:`modal-overlay`,onClick:()=>R(``),children:(0,D.jsxs)(`div`,{className:`modal-content runsheet-modal`,onClick:e=>e.stopPropagation(),children:[(0,D.jsxs)(`div`,{className:`modal-header`,children:[(0,D.jsx)(`h2`,{children:`Run Sheet Details`}),(0,D.jsxs)(`div`,{className:`runsheet-modal-actions`,children:[(0,D.jsxs)(u,{variant:`secondary`,size:`sm`,onClick:()=>M(q,P),children:[(0,D.jsx)(o,{size:14}),` Print`]}),(0,D.jsx)(u,{variant:`ghost`,size:`icon`,className:`modal-close-btn`,onClick:()=>R(``),type:`button`,children:`×`})]})]}),(0,D.jsx)(z,{sheet:q})]})})]})};export{B as default};
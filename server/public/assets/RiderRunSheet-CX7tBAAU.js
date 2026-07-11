import{i as e,l as t,r as n}from"./api-YN7heKRk.js";import{t as r}from"./eye-off-CWOGcnv2.js";import{t as i}from"./eye-CQkpDcIe.js";import{t as a}from"./package-check-CkLeBuz3.js";import{t as o}from"./printer-DM2eKH4t.js";import{t as s}from"./Table-vAGDeuMj.js";import{$ as c,C as l,W as u,d,dt as f,et as p,ft as m,h,ht as g,n as _,p as v,rt as y}from"./index-CPnL1xPO.js";import{a as b}from"./users.service-BGG-jovR.js";/* empty css              */import{t as x}from"./PageHeader-C1Rjq-rj.js";import{r as S,t as C}from"./nepaliDate-CDAbJrWR.js";import{t as w}from"./StatCard-DfjdUrYQ.js";import{t as T}from"./format-C-aHcYe3.js";var E=t(e(),1),D=e=>e.toLocaleString(void 0,{maximumFractionDigits:0});function O(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}var k=`
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
`;function A(e,t){let n=window.open(``,`_blank`,`width=900,height=650`);if(!n){alert(`Please allow popups for this site to print the run sheet.`);return}let r=e.parcels.map((e,n)=>`
    <tr>
      <td class="num">${n+1}</td>
      <td class="mono">${O(e.trackingId)}</td>
      <td>${O(e.receiverName)}<small>${O(e.receiverPhone)}</small></td>
      <td>${O(e.address||e.destination||`-`)}</td>
      <td class="num">${e.pieces}</td>
      <td class="num">${e.codAmount>0?D(e.codAmount):`-`}</td>
      <td>${O(e.vendorName||`-`)}</td>
      <td>${O(t[e.status]??e.status)}</td>
      <td class="sign"></td>
    </tr>`).join(``),i=[[`Rider`,e.rider.name],[`Phone`,e.rider.phone||`-`],[`Vehicle`,e.rider.vehicleNo||`-`],[`Hub`,e.rider.hub||`-`],[`Total Items`,String(e.totalItems)],[`Delivered`,String(e.deliveredItems)],[`Failed`,String(e.failedItems)],[`Total COD`,`NPR ${D(e.totalCod)}`]];n.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Run Sheet ${O(e.sheetNo)} — ParcelMoover</title>
  <style>${k}</style>
</head>
<body>
  <header class="sheet-header">
    <div>
      <div class="brand">ParcelMoover</div>
      <div class="doc-title">Rider Run Sheet</div>
    </div>
    <div>
      <div class="sheet-no">${O(e.sheetNo)}</div>
      <div class="sheet-date">${O(C(e.createdAt))} · ${O(S(e.createdAt,!0))}</div>
    </div>
  </header>

  <div class="meta-grid">
    ${i.map(([e,t])=>`
    <div class="meta-item">
      <div class="meta-label">${O(e)}</div>
      <div class="meta-value">${O(t)}</div>
    </div>`).join(``)}
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
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
        <td class="num">${D(e.totalCod)}</td>
        <td colspan="3">${e.totalItems} parcel${e.totalItems===1?``:`s`}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="signature">Prepared By</div>
    <div class="signature">Rider (${O(e.rider.name)})</div>
    <div class="signature">Verified By</div>
  </div>

<script>
  window.addEventListener('load', function() {
    window.print();
    window.addEventListener('afterprint', function() { window.close(); });
  });
<\/script>
</body>
</html>`),n.document.close()}var j=n(),M=``,N={pickup_ordered:`Pickup Ordered`,rider_assigned:`Rider Assigned`,picked_up:`Pickup Completed`,arrived:`Arrived at Origin`,ready_to_deliver:`Ready to Deliver`,sent_for_delivery:`Sent for Delivery`,oov:`Transit`,dispatched:`Dispatched`,arrived_at_branch:`Arrived at Destination`,hold:`Hold`,loss_and_damage:`Loss and Damage`,delivered:`Delivered`,partially_delivered:`Partially Delivered`,failed_pickup:`Failed Pickup`,failed_delivery:`Failed Delivery`,cancelled:`Cancelled`,follow_up:`Follow Up`,ready_to_return:`Ready to Return`,sent_to_vendor:`Sent to Vendor`,returned_to_vendor:`Returned to Vendor`},P=e=>e===`delivered`?`success`:e===`partially_delivered`?`warning`:[`failed_delivery`,`failed_pickup`,`loss_and_damage`].includes(e)?`danger`:e===`cancelled`?`neutral`:[`sent_for_delivery`,`ready_to_deliver`].includes(e)?`info`:`warning`,F=()=>new Date(Date.now()+345*60*1e3).toISOString().slice(0,10),I=({iso:e})=>e?(0,j.jsxs)(`div`,{className:`runsheet-datetime`,children:[(0,j.jsx)(`span`,{children:C(e)}),(0,j.jsx)(`small`,{children:S(e,!0)})]}):(0,j.jsx)(j.Fragment,{children:`-`}),L=[{header:`#`,accessor:e=>`#${e.orderNumber}`,width:`70px`},{header:`TRACKING ID`,accessor:e=>(0,j.jsx)(g,{to:`/orders/track/${e.trackingId}`,className:`tracking-id-link`,children:e.trackingId}),width:`160px`,className:`runsheet-tracking-cell`},{header:`RECEIVER`,accessor:e=>(0,j.jsxs)(`div`,{className:`runsheet-party-cell`,children:[(0,j.jsx)(`span`,{children:e.receiverName}),(0,j.jsx)(`small`,{children:e.receiverPhone})]}),width:`200px`},{header:`DELIVERY ADDRESS`,accessor:e=>e.address||e.destination||`-`},{header:`PIECES`,accessor:e=>e.pieces,width:`80px`},{header:`COD`,accessor:e=>e.codAmount>0?T(e.codAmount,0):`-`,width:`110px`},{header:`VENDOR`,accessor:e=>e.vendorName||`-`,width:`160px`},{header:`STATUS`,accessor:e=>(0,j.jsx)(h,{tone:P(e.status),children:N[e.status]??e.status}),width:`160px`}],R=({sheet:e})=>{let t=E.useRef(null);return(0,E.useEffect)(()=>{t.current?.scrollIntoView({behavior:`smooth`,block:`nearest`})},[e.id]),(0,j.jsxs)(`section`,{ref:t,className:`runsheet-rider-card`,children:[(0,j.jsxs)(`header`,{className:`runsheet-rider-header`,children:[(0,j.jsxs)(`div`,{className:`runsheet-rider-identity`,children:[(0,j.jsx)(`div`,{className:`runsheet-rider-avatar`,children:(0,j.jsx)(f,{size:20})}),(0,j.jsxs)(`div`,{className:`runsheet-rider-info`,children:[(0,j.jsx)(`h2`,{children:e.sheetNo}),(0,j.jsxs)(`div`,{className:`runsheet-rider-meta`,children:[(0,j.jsxs)(`span`,{children:[(0,j.jsx)(f,{size:13}),` `,e.rider.name]}),e.rider.phone&&(0,j.jsxs)(`span`,{children:[(0,j.jsx)(c,{size:13}),` `,e.rider.phone]}),e.rider.vehicleNo&&(0,j.jsxs)(`span`,{children:[(0,j.jsx)(u,{size:13}),` `,e.rider.vehicleNo]}),e.rider.hub&&(0,j.jsxs)(`span`,{children:[(0,j.jsx)(y,{size:13}),` `,e.rider.hub]})]})]})]}),(0,j.jsxs)(`div`,{className:`runsheet-rider-totals`,children:[(0,j.jsxs)(h,{tone:`info`,variant:`solid`,children:[e.outItems,` out`]}),(0,j.jsxs)(h,{tone:`success`,variant:`solid`,children:[e.deliveredItems,` delivered`]}),e.failedItems>0&&(0,j.jsxs)(h,{tone:`danger`,variant:`solid`,children:[e.failedItems,` failed`]}),(0,j.jsxs)(h,{tone:`warning`,variant:`solid`,children:[`COD `,T(e.totalCod,0)]})]})]}),(0,j.jsx)(s,{columns:L,data:e.parcels,selectable:!1,minWidth:`1010px`,tableClassName:`runsheet-table`,emptyMessage:`This run sheet has no parcels.`})]})},z=()=>{let[e,t]=(0,E.useState)([]),[n,c]=(0,E.useState)({totalSheets:0,totalItems:0,deliveredItems:0,outItems:0,totalCod:0}),[f,g]=(0,E.useState)([]),[y,S]=(0,E.useState)(M),[C,D]=(0,E.useState)(F),[O,k]=(0,E.useState)(``),[P,L]=(0,E.useState)(``),[z,B]=(0,E.useState)(!0),[V,H]=(0,E.useState)(``);(0,E.useEffect)(()=>{(async()=>{try{let e=await b();e?.success&&Array.isArray(e.data)&&g(e.data.filter(e=>e.status===`active`))}catch{}})()},[]);let U=(0,E.useCallback)(async()=>{B(!0);try{let e=await d({riderId:y||void 0,date:C||void 0});e?.success&&e.data&&(t(e.data.sheets),c(e.data.summary),H(``))}catch{H(`Failed to load run sheets. Showing the last loaded data, if any.`)}finally{B(!1)}},[y,C]);(0,E.useEffect)(()=>{U()},[U]),(0,E.useEffect)(()=>v(U),[U]);let W=(0,E.useMemo)(()=>e.map((e,t)=>({...e,sn:t+1})),[e]),G=e.find(e=>e.id===O),K=e.find(e=>e.id===P),q=[{header:`S.N.`,accessor:e=>e.sn,width:`60px`},{header:`RUNSHEET ID`,accessor:e=>(0,j.jsx)(`button`,{type:`button`,className:`runsheet-id-link`,onClick:()=>L(e.id),children:e.sheetNo}),width:`210px`,className:`runsheet-tracking-cell`},{header:`CREATED`,accessor:e=>(0,j.jsx)(I,{iso:e.createdAt}),width:`120px`},{header:`UPDATED`,accessor:e=>(0,j.jsx)(I,{iso:e.updatedAt}),width:`120px`},{header:`VEHICLE`,accessor:e=>e.rider.vehicleNo||`N/A`,width:`110px`},{header:`DRIVER`,accessor:e=>(0,j.jsxs)(`div`,{className:`runsheet-party-cell`,children:[(0,j.jsx)(`span`,{children:e.rider.name}),(0,j.jsx)(`small`,{children:e.rider.phone})]}),width:`180px`},{header:`HUB`,accessor:e=>e.rider.hub||`-`,width:`130px`},{header:`TOTAL ITEMS`,accessor:e=>(0,j.jsx)(`strong`,{children:e.totalItems}),width:`100px`},{header:`DELIVERED ITEMS`,accessor:e=>e.totalItems>0&&e.deliveredItems===e.totalItems?(0,j.jsx)(h,{tone:`success`,children:e.deliveredItems}):(0,j.jsx)(`strong`,{children:e.deliveredItems}),width:`130px`},{header:`COD`,accessor:e=>e.totalCod>0?T(e.totalCod,0):`-`,width:`110px`},{header:`PARCELS`,accessor:e=>(0,j.jsx)(l,{variant:`outline`,size:`sm`,onClick:()=>k(t=>t===e.id?``:e.id),children:O===e.id?(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(r,{size:14}),` Hide`]}):(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(i,{size:14}),` View`]})}),width:`110px`}];return(0,j.jsxs)(`div`,{className:`runsheet-container`,children:[(0,j.jsx)(x,{title:`Rider Run Sheet`,subtitle:`Every hand-off batch sent out for delivery - one numbered sheet per rider trip.`}),(0,j.jsxs)(`div`,{className:`runsheet-stats`,children:[(0,j.jsx)(w,{icon:p,label:`Total Items`,value:n.totalItems}),(0,j.jsx)(w,{icon:u,label:`Out for Delivery`,value:n.outItems}),(0,j.jsx)(w,{icon:a,label:`Delivered`,value:n.deliveredItems}),(0,j.jsx)(w,{icon:m,label:`COD on Sheets`,value:T(n.totalCod,0)})]}),(0,j.jsx)(`div`,{className:`runsheet-toolbar`,children:(0,j.jsxs)(`div`,{className:`runsheet-filters`,children:[(0,j.jsxs)(`div`,{className:`runsheet-filter-group`,children:[(0,j.jsx)(`label`,{className:`runsheet-filter-label`,children:`Rider`}),(0,j.jsx)(_,{options:[{id:M,label:`All Riders`},...f.map(e=>({id:e.id,label:e.name}))],value:y,onChange:S,placeholder:`All Riders`,searchPlaceholder:`Search rider by name...`,emptyMessage:`No active riders found.`})]}),(0,j.jsxs)(`div`,{className:`runsheet-filter-group`,children:[(0,j.jsx)(`label`,{className:`runsheet-filter-label`,children:`Date`}),(0,j.jsx)(`input`,{type:`date`,value:C,onChange:e=>D(e.target.value),className:`runsheet-date-input`})]})]})}),V&&(0,j.jsx)(`p`,{className:`runsheet-error`,children:V}),(0,j.jsx)(s,{columns:q,data:W,selectable:!1,getRowClassName:e=>e.id===O?`runsheet-row-active`:``,loading:z&&W.length===0,loadingMessage:`Loading run sheets...`,emptyMessage:`No run sheets on ${C}.`,minWidth:`1420px`,tableClassName:`runsheet-table`}),G&&(0,j.jsx)(R,{sheet:G}),K&&(0,j.jsx)(`div`,{className:`modal-overlay`,onClick:()=>L(``),children:(0,j.jsxs)(`div`,{className:`modal-content runsheet-modal`,onClick:e=>e.stopPropagation(),children:[(0,j.jsxs)(`div`,{className:`modal-header`,children:[(0,j.jsx)(`h2`,{children:`Run Sheet Details`}),(0,j.jsxs)(`div`,{className:`runsheet-modal-actions`,children:[(0,j.jsxs)(l,{variant:`secondary`,size:`sm`,onClick:()=>A(K,N),children:[(0,j.jsx)(o,{size:14}),` Print`]}),(0,j.jsx)(l,{variant:`ghost`,size:`icon`,className:`modal-close-btn`,onClick:()=>L(``),type:`button`,children:`×`})]})]}),(0,j.jsx)(R,{sheet:K})]})})]})};export{z as default};
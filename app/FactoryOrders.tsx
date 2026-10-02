"use client";

import {FormEvent,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";

type FactoryOrder={
  id:number;
  factory_name:string;
  product_details:string;
  order_date:string;
  created_by:string;
  created_at:string;
};

type Shipment={
  id:number;
  carrier:string;
  tracking_number:string;
  status:"shipped"|"received";
  shipped_at:string;
  received_at:string|null;
  created_by:string;
};

type ShipmentOrder={
  shipment_id:number;
  order_id:number;
};

type View="preparing"|"shipped"|"received";

const todayDate=()=>new Date().toLocaleDateString("en-CA");
const toIsoDate=(date:string)=>date+`T12:00:00.000Z`;
const onlyDate=(value:string|null)=>value?new Date(value).toLocaleDateString("ar",{dateStyle:"medium"}):"—";

export default function FactoryOrders({adminId}:{adminId:string}){
  const [orders,setOrders]=useState<FactoryOrder[]>([]);
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [links,setLinks]=useState<ShipmentOrder[]>([]);
  const [view,setView]=useState<View>("preparing");
  const [selected,setSelected]=useState<Set<number>>(new Set());
  const [showShipping,setShowShipping]=useState(false);
  const [message,setMessage]=useState<{type:"ok"|"err";text:string}|null>(null);
  const [saving,setSaving]=useState(false);

  async function load(){
    const s=supabase();
    const [{data:o,error:oe},{data:sh,error:se},{data:ln,error:le}]=await Promise.all([
      s.from("factory_orders").select("*").order("created_at",{ascending:false}),
      s.from("shipments").select("*").order("shipped_at",{ascending:false}),
      s.from("shipment_orders").select("*")
    ]);
    if(oe||se||le){
      setMessage({type:"err",text:(oe||se||le)?.message||"تعذر تحميل الطلبات"});
      return;
    }
    setOrders(o||[]);
    setShipments(sh||[]);
    setLinks(ln||[]);
  }

  useEffect(()=>{load()},[]);

  const orderStatus=useMemo(()=>{
    const map=new Map<number,View>();
    for(const order of orders){
      const shipmentIds=links.filter(x=>x.order_id===order.id).map(x=>x.shipment_id);
      if(!shipmentIds.length){map.set(order.id,"preparing");continue}
      const related=shipments.filter(x=>shipmentIds.includes(x.id));
      map.set(order.id,related.length>0&&related.every(x=>x.status==="received")?"received":"shipped");
    }
    return map;
  },[orders,shipments,links]);

  const preparing=orders.filter(x=>orderStatus.get(x.id)==="preparing");
  const shipped=shipments.filter(x=>x.status==="shipped");
  const received=shipments.filter(x=>x.status==="received");

  function toggle(id:number){
    setSelected(prev=>{
      const next=new Set(prev);
      next.has(id)?next.delete(id):next.add(id);
      return next;
    });
  }

  async function addOrder(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(saving)return;
    setSaving(true);setMessage(null);
    const form=e.currentTarget,f=new FormData(form);
    const {error}=await supabase().from("factory_orders").insert({
      factory_name:String(f.get("factory_name")).trim(),
      product_details:String(f.get("product_details")).trim(),
      order_date:String(f.get("order_date")),
      created_by:adminId
    });
    setSaving(false);
    if(error){setMessage({type:"err",text:error.message});return}
    form.reset();
    const dateInput=form.elements.namedItem("order_date") as HTMLInputElement|null;
    if(dateInput)dateInput.value=todayDate();
    setMessage({type:"ok",text:"تمت إضافة الطلب إلى قيد التجهيز."});
    await load();
  }

  async function createShipment(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!selected.size||saving)return;
    setSaving(true);setMessage(null);
    const form=e.currentTarget,f=new FormData(form),s=supabase();
    const shippedDate=String(f.get("shipped_date"));
    const {data:shipment,error:shipmentError}=await s.from("shipments").insert({
      carrier:String(f.get("carrier")).trim(),
      tracking_number:String(f.get("tracking_number")).trim(),
      shipped_at:toIsoDate(shippedDate),
      created_by:adminId
    }).select("id").single();

    if(shipmentError||!shipment){
      setSaving(false);
      setMessage({type:"err",text:shipmentError?.message||"تعذر إنشاء الشحنة"});
      return;
    }

    const rows=Array.from(selected).map(order_id=>({shipment_id:shipment.id,order_id}));
    const {error:linkError}=await s.from("shipment_orders").insert(rows);
    if(linkError){
      await s.from("shipments").delete().eq("id",shipment.id);
      setSaving(false);
      setMessage({type:"err",text:linkError.message});
      return;
    }

    setSaving(false);
    setSelected(new Set());
    setShowShipping(false);
    setView("shipped");
    setMessage({type:"ok",text:"تم شحن الطلبات المحددة في شحنة واحدة."});
    await load();
  }

  async function changeOrderDate(id:number,date:string){
    if(!date)return;
    const {error}=await supabase().from("factory_orders").update({order_date:date}).eq("id",id);
    if(error){setMessage({type:"err",text:error.message});return}
    setOrders(prev=>prev.map(x=>x.id===id?{...x,order_date:date}:x));
  }

  async function changeShipmentDate(id:number,date:string){
    if(!date)return;
    const shipped_at=toIsoDate(date);
    const {error}=await supabase().from("shipments").update({shipped_at}).eq("id",id);
    if(error){setMessage({type:"err",text:error.message});return}
    setShipments(prev=>prev.map(x=>x.id===id?{...x,shipped_at}:x));
  }

  async function receiveShipment(shipmentId:number){
    if(saving)return;
    setSaving(true);setMessage(null);
    const {error}=await supabase().from("shipments").update({
      status:"received",
      received_at:new Date().toISOString(),
      received_by:adminId
    }).eq("id",shipmentId);
    setSaving(false);
    if(error){setMessage({type:"err",text:error.message});return}
    setMessage({type:"ok",text:"تم تسجيل استلام الشحنة."});
    await load();
  }

  const fmt=(value:string|null)=>value?new Date(value).toLocaleString("ar",{dateStyle:"medium",timeStyle:"short"}):"—";
  const ordersFor=(shipmentId:number)=>orders.filter(o=>links.some(l=>l.shipment_id===shipmentId&&l.order_id===o.id));

  const orderDetails=(o:FactoryOrder)=><div className="history" key={o.id}>
    <b>{o.factory_name}</b>
    <span>{o.product_details}</span>
    <div className="dateLine">
      <label>تاريخ الطلب</label>
      <input type="date" value={o.order_date} onChange={e=>changeOrderDate(o.id,e.target.value)}/>
    </div>
  </div>;

  const shipmentDateInput=(sh:Shipment)=><div className="dateLine top8">
    <label>تاريخ الشحن</label>
    <input type="date" value={sh.shipped_at.slice(0,10)} onChange={e=>changeShipmentDate(sh.id,e.target.value)}/>
  </div>;

  return <>
    <div className="row reportHead">
      <div><h2>طلبات المصانع</h2><p className="muted">من تجهيز الطلب حتى استلام الشحنة</p></div>
    </div>

    {message&&<div className={`notice ${message.type}`}>{message.text}</div>}

    <div className="tabs adminTabs">
      <button className={view==="preparing"?"primary":""} onClick={()=>setView("preparing")}>قيد التجهيز ({preparing.length})</button>
      <button className={view==="shipped"?"primary":""} onClick={()=>setView("shipped")}>تم الشحن ({shipped.length})</button>
      <button className={view==="received"?"primary":""} onClick={()=>setView("received")}>تم الاستلام ({received.length})</button>
    </div>

    {view==="preparing"&&<>
      <form className="card" onSubmit={addOrder}>
        <div className="field"><label>اسم المصنع</label><input name="factory_name" required/></div>
        <div className="field"><label>تفاصيل المنتج</label><textarea name="product_details" placeholder="مثال: MG-825 × 500&#10;MG-834 × 300" required/></div>
        <div className="field"><label>تاريخ الطلب</label><input name="order_date" type="date" defaultValue={todayDate()} required/></div>
        <button className="primary full" disabled={saving}>{saving?"جاري الحفظ…":"إضافة الطلب"}</button>
      </form>

      {preparing.length>0&&<div className="card">
        <div className="row"><b>اختر الطلبات التي شُحنت معًا</b><span className="badge">{selected.size}</span></div>
        {preparing.map(order=><div className="customer factoryOrderRow" key={order.id}>
          <input type="checkbox" checked={selected.has(order.id)} onChange={()=>toggle(order.id)}/>
          <div>
            <b>{order.factory_name}</b>
            <div>{order.product_details}</div>
            <div className="dateLine top8">
              <label>تاريخ الطلب</label>
              <input type="date" value={order.order_date} onChange={e=>changeOrderDate(order.id,e.target.value)}/>
            </div>
          </div>
        </div>)}
        <button className="primary full" disabled={!selected.size} onClick={()=>setShowShipping(true)}>تم الشحن</button>
      </div>}

      {!preparing.length&&<div className="card muted">لا توجد طلبات قيد التجهيز.</div>}

      {showShipping&&<div className="modal">
        <div className="modalBox">
          <div className="row"><h3>تسجيل الشحنة</h3><button onClick={()=>setShowShipping(false)}>✕</button></div>
          <p className="muted">{selected.size} طلب سيتم ربطها بنفس الشحنة.</p>
          <form onSubmit={createShipment}>
            <div className="field"><label>شركة الشحن</label><input name="carrier" required/></div>
            <div className="field"><label>رقم الشحنة / التتبع</label><input name="tracking_number" required/></div>
            <div className="field"><label>تاريخ الشحن</label><input name="shipped_date" type="date" defaultValue={todayDate()} required/></div>
            <button className="primary full" disabled={saving}>{saving?"جاري الحفظ…":"تأكيد تم الشحن"}</button>
          </form>
        </div>
      </div>}
    </>}

    {view==="shipped"&&<>
      {shipped.map(sh=><div className="card" key={sh.id}>
        <div className="row">
          <div><b>{sh.carrier}</b><div className="muted">{sh.tracking_number}</div></div>
          <span className="status">تم الشحن</span>
        </div>
        {shipmentDateInput(sh)}
        <div className="visitDetails">{ordersFor(sh.id).map(orderDetails)}</div>
        <button className="primary full" disabled={saving} onClick={()=>receiveShipment(sh.id)}>تم الاستلام</button>
      </div>)}
      {!shipped.length&&<div className="card muted">لا توجد شحنات قيد الاستلام.</div>}
    </>}

    {view==="received"&&<>
      {received.map(sh=><div className="card" key={sh.id}>
        <div className="row">
          <div><b>{sh.carrier}</b><div className="muted">{sh.tracking_number}</div></div>
          <span className="status ok">تم الاستلام</span>
        </div>
        {shipmentDateInput(sh)}
        <div className="muted top8">تم الاستلام: {fmt(sh.received_at)}</div>
        <div className="visitDetails">{ordersFor(sh.id).map(orderDetails)}</div>
      </div>)}
      {!received.length&&<div className="card muted">لا توجد شحنات مستلمة بعد.</div>}
    </>}
  </>;
}

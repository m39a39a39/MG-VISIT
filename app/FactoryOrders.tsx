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

type FactoryOrderItem={
  id:number;
  order_id:number;
  product_details:string;
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

type ShipmentItem={
  shipment_id:number;
  item_id:number;
};

type View="preparing"|"shipped"|"received";

const todayDate=()=>new Date().toLocaleDateString("en-CA");
const toIsoDate=(date:string)=>date+`T12:00:00.000Z`;

export default function FactoryOrders({adminId}:{adminId:string}){
  const [orders,setOrders]=useState<FactoryOrder[]>([]);
  const [items,setItems]=useState<FactoryOrderItem[]>([]);
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [links,setLinks]=useState<ShipmentItem[]>([]);
  const [view,setView]=useState<View>("preparing");
  const [selected,setSelected]=useState<Set<number>>(new Set());
  const [showShipping,setShowShipping]=useState(false);
  const [message,setMessage]=useState<{type:"ok"|"err";text:string}|null>(null);
  const [saving,setSaving]=useState(false);

  async function load(){
    const s=supabase();
    const [{data:o,error:oe},{data:i,error:ie},{data:sh,error:se},{data:ln,error:le}]=await Promise.all([
      s.from("factory_orders").select("*").order("created_at",{ascending:false}),
      s.from("factory_order_items").select("*").order("id"),
      s.from("shipments").select("*").order("shipped_at",{ascending:false}),
      s.from("shipment_items").select("*")
    ]);
    if(oe||ie||se||le){
      setMessage({type:"err",text:(oe||ie||se||le)?.message||"تعذر تحميل الطلبات"});
      return;
    }
    setOrders(o||[]);
    setItems(i||[]);
    setShipments(sh||[]);
    setLinks(ln||[]);
  }

  useEffect(()=>{load()},[]);

  const itemStatus=useMemo(()=>{
    const map=new Map<number,View>();
    for(const item of items){
      const shipmentIds=links.filter(x=>x.item_id===item.id).map(x=>x.shipment_id);
      if(!shipmentIds.length){map.set(item.id,"preparing");continue}
      const related=shipments.filter(x=>shipmentIds.includes(x.id));
      map.set(item.id,related.length>0&&related.every(x=>x.status==="received")?"received":"shipped");
    }
    return map;
  },[items,shipments,links]);

  const preparingItems=items.filter(x=>itemStatus.get(x.id)==="preparing");
  const shipped=shipments.filter(x=>x.status==="shipped");
  const received=shipments.filter(x=>x.status==="received");
  const preparingOrders=orders.filter(o=>items.some(i=>i.order_id===o.id&&itemStatus.get(i.id)==="preparing"));

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
    const form=e.currentTarget,f=new FormData(form);
    const raw=String(f.get("product_details")||"");
    const products=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    if(!products.length){
      setMessage({type:"err",text:"أضف منتجًا واحدًا على الأقل."});
      return;
    }

    setSaving(true);setMessage(null);
    const s=supabase();
    const {data:order,error:orderError}=await s.from("factory_orders").insert({
      factory_name:String(f.get("factory_name")).trim(),
      product_details:products.join("\n"),
      order_date:String(f.get("order_date")),
      created_by:adminId
    }).select("id").single();

    if(orderError||!order){
      setSaving(false);
      setMessage({type:"err",text:orderError?.message||"تعذر إضافة الطلب"});
      return;
    }

    const {error:itemError}=await s.from("factory_order_items").insert(
      products.map(product_details=>({order_id:order.id,product_details}))
    );

    if(itemError){
      await s.from("factory_orders").delete().eq("id",order.id);
      setSaving(false);
      setMessage({type:"err",text:itemError.message});
      return;
    }

    setSaving(false);
    form.reset();
    const dateInput=form.elements.namedItem("order_date") as HTMLInputElement|null;
    if(dateInput)dateInput.value=todayDate();
    setMessage({type:"ok",text:"تمت إضافة الطلب والمنتجات إلى قيد التجهيز."});
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

    const rows=Array.from(selected).map(item_id=>({shipment_id:shipment.id,item_id}));
    const {error:linkError}=await s.from("shipment_items").insert(rows);
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
    setMessage({type:"ok",text:"تم شحن المنتجات المحددة في شحنة واحدة."});
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
  const itemsForOrder=(orderId:number)=>items.filter(i=>i.order_id===orderId);
  const itemsForShipment=(shipmentId:number)=>items.filter(i=>links.some(l=>l.shipment_id===shipmentId&&l.item_id===i.id));
  const orderForItem=(item:FactoryOrderItem)=>orders.find(o=>o.id===item.order_id);

  const shipmentDateInput=(sh:Shipment)=><div className="dateLine top8">
    <label>تاريخ الشحن</label>
    <input type="date" value={sh.shipped_at.slice(0,10)} onChange={e=>changeShipmentDate(sh.id,e.target.value)}/>
  </div>;

  const shipmentItem=(item:FactoryOrderItem)=>{
    const order=orderForItem(item);
    return <div className="history" key={item.id}>
      <div className="row"><b>{order?.factory_name||"المصنع"}</b></div>
      <span>{item.product_details}</span>
      {order&&<div className="dateLine">
        <label>تاريخ الطلب</label>
        <input type="date" value={order.order_date} onChange={e=>changeOrderDate(order.id,e.target.value)}/>
      </div>}
    </div>;
  };

  return <>
    <div className="row reportHead">
      <div><h2>طلبات المصانع</h2><p className="muted">كل منتج يمكن شحنه بشكل مستقل</p></div>
    </div>

    {message&&<div className={`notice ${message.type}`}>{message.text}</div>}

    <div className="tabs adminTabs">
      <button className={view==="preparing"?"primary":""} onClick={()=>setView("preparing")}>قيد التجهيز ({preparingItems.length})</button>
      <button className={view==="shipped"?"primary":""} onClick={()=>setView("shipped")}>تم الشحن ({shipped.length})</button>
      <button className={view==="received"?"primary":""} onClick={()=>setView("received")}>تم الاستلام ({received.length})</button>
    </div>

    {view==="preparing"&&<>
      <form className="card" onSubmit={addOrder}>
        <div className="field"><label>اسم المصنع</label><input name="factory_name" required/></div>
        <div className="field">
          <label>المنتجات</label>
          <textarea name="product_details" placeholder={"كل منتج في سطر منفصل\nمثال:\nشاحن سيارة × 500\nشاحن بيت × 500"} required/>
          <div className="muted top8">اكتب كل منتج في سطر مستقل حتى تستطيع شحنه لوحده لاحقًا.</div>
        </div>
        <div className="field"><label>تاريخ الطلب</label><input name="order_date" type="date" defaultValue={todayDate()} required/></div>
        <button className="primary full" disabled={saving}>{saving?"جاري الحفظ…":"إضافة الطلب"}</button>
      </form>

      {preparingOrders.map(order=><div className="card factoryOrderCard" key={order.id}>
        <div className="row">
          <b>{order.factory_name}</b>
          <span className="badge">{itemsForOrder(order.id).length} منتج</span>
        </div>
        <div className="dateLine top8">
          <label>تاريخ الطلب</label>
          <input type="date" value={order.order_date} onChange={e=>changeOrderDate(order.id,e.target.value)}/>
        </div>

        <div className="factoryItems">
          {itemsForOrder(order.id).map(item=>{
            const status=itemStatus.get(item.id)||"preparing";
            return <div className="customer factoryItemRow" key={item.id}>
              {status==="preparing"
                ?<input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggle(item.id)}/>
                :<span className="checkboxSpacer"/>}
              <div className="factoryItemText">{item.product_details}</div>
              <span className={status==="received"?"status ok":"status"}>
                {status==="preparing"?"قيد التجهيز":status==="shipped"?"تم الشحن":"تم الاستلام"}
              </span>
            </div>
          })}
        </div>
      </div>)}

      {preparingItems.length>0&&<button className="primary full" disabled={!selected.size} onClick={()=>setShowShipping(true)}>
        تم شحن المنتجات المحددة ({selected.size})
      </button>}

      {!preparingItems.length&&<div className="card muted">لا توجد منتجات قيد التجهيز.</div>}

      {showShipping&&<div className="modal">
        <div className="modalBox">
          <div className="row"><h3>تسجيل الشحنة</h3><button onClick={()=>setShowShipping(false)}>✕</button></div>
          <p className="muted">{selected.size} منتج سيتم ربطها بنفس الشحنة.</p>
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
        <div className="visitDetails">{itemsForShipment(sh.id).map(shipmentItem)}</div>
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
        <div className="visitDetails">{itemsForShipment(sh.id).map(shipmentItem)}</div>
      </div>)}
      {!received.length&&<div className="card muted">لا توجد شحنات مستلمة بعد.</div>}
    </>}
  </>;
}

import { createFileRoute } from "@tanstack/react-router";
import { EcoReport, type CustomSystem } from "@/components/eco-report";
const kw: number[] = [129.68639648750002,123.2578874675,109.3899354925,106.7313697375,99.028986795,99.14478559000001,85.616980588,85.57354376999999,93.64446487800001,112.42830424600001,124.2719644,124.08465066800002,105.093175638,118.35048376,141.186055136,159.53730546,177.09620406,160.9260086,169.91155354999998,139.140313445,151.4328065,147.45195953333334,154.91362836666667,155.5350734];
function P() {
  const PSH=5.5,PR=0.8,K=3.3,DOD=0.9,YEARS=25,DEG=0.005,OM=0.01,dp=1.1,capex=279183,batKwh=720;
  const dailyKwh=414.72*PSH*PR; const loadDay=kw.reduce((a,b)=>a+b,0);
  const sun=Array.from({length:24},(_,h)=>(h>=6&&h<18?Math.sin(((h-6+0.5)/12)*Math.PI):0)); const ss=sun.reduce((a,b)=>a+b,0);
  let direct=0,excess=0; sun.forEach((s,h)=>{const p=dailyKwh*s/ss; direct+=Math.min(p,kw[h]!); excess+=Math.max(0,p-kw[h]!);});
  const covered=direct+Math.min(excess*0.9,batKwh*DOD,loadDay-direct);
  const liters=Math.round(covered*365/K), saving=Math.round(liters*dp*1.1);
  let cum=-capex, payback: number|null=null; const rows: {y:number;cum:number}[]=[];
  for(let y=1;y<=YEARS;y++){const net=saving*Math.pow(1-DEG,y-1)-capex*OM; const prev=cum; cum+=net; rows.push({y,cum:Math.round(cum)}); if(payback===null&&prev<0&&cum>=0) payback=y-1+Math.abs(prev)/net;}
  const sys: CustomSystem={panelName:"Suntech 720W",panelW:720,panels:576,invName:"Deye",invKw:50,invN:8,batName:"HiTHIUM",batUnit:16,batN:45,capex};
  return <div dir="rtl" className="p-4"><EcoReport kw={kw} price={dp} project="مصنع ارض الخليج للبلاستيك" system={sys} results={{dailyKwh,yearKwh:dailyKwh*365,loadDay,coverage:Math.round(covered/loadDay*100),liters,saving,payback,cum,roi:Math.round(cum/capex*100),wattCost:(capex/414720).toFixed(2)+" $/W",years:YEARS,rows}} /></div>;
}
export const Route = createFileRoute("/tmp-print")({ component: P });

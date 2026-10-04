import { useEffect, useMemo, useRef, useState } from "react";
import { ShoppingCart, Download } from "lucide-react";

// تقرير دراسة الجدوى التنفيذي — مقارنة وضع المولد فقط بالمنظومة المقترحة (شمس + تخزين)
const PSH = 5.5, PR = 0.8, KWH_PER_L = 3.3, DOD = 0.9, CO2_PER_L = 2.68;
const PV_USD_KWP = 450, BAT_USD_KWH = 300, INV_USD_KW = 150;
const BAT_MOD = 16, RACK = 15, PANEL_W = 720;
const nf = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const C = { sun: "#f5a01e", bat: "#15803d", gen: "#7f1d1d", load: "#e60012", grid: "#d5dae4" };

type Hour = { h: number; load: number; pv: number; direct: number; batOut: number; charge: number; gen: number; soc: number };

export type CustomSystem = { panelName: string; panelW: number; panels: number; invName: string; invKw: number; invN: number; batName: string; batUnit: number; batN: number; capex: number };

function design(kw: number[], sys?: CustomSystem, target?: number) {
  const total = kw.reduce((s, v) => s + v, 0);
  const peak = Math.max(...kw, 0);
  const day = kw.reduce((s, v, h) => s + (h >= 7 && h < 17 ? v : 0), 0);
  const evening0 = kw.reduce((s, v, h) => s + (h >= 17 && h < 22 ? v : 0), 0) + (kw[6] ?? 0);
  // عند تحديد نسبة تغطية مستهدفة: النهار أولاً ثم البطاريات لباقي النسبة
  const want = target !== undefined ? total * target : undefined;
  const pvDay = want !== undefined ? Math.min(day, want) : day;
  const evening = want !== undefined ? Math.max(0, want - day) * (target! >= 0.99 ? 1.12 : 1.05) : evening0;
  const smallBat = peak <= 16 ? 5.12 : BAT_MOD;
  const mods = sys ? sys.batN : Math.max(evening > 0 ? 1 : 0, Math.ceil(evening / DOD / smallBat));
  const batKwh = sys ? sys.batN * sys.batUnit : mods * smallBat;
  const racks = Math.ceil(mods / RACK);
  const panels = sys ? sys.panels : Math.max(1, Math.ceil(((pvDay * (want !== undefined ? 1.08 : 1) + evening / 0.95) / (PSH * PR)) * 1000 / PANEL_W));
  const kwp = (panels * (sys ? sys.panelW : PANEL_W)) / 1000;
  const unit = sys ? sys.invKw : peak > 100 ? 125 : peak > 20 ? 50 : peak > 12 ? 20 : peak > 8 ? 12 : 8;
  const invN = sys ? sys.invN : Math.max(1, Math.ceil((peak * 1.25) / unit));
  const invBrand = sys ? sys.invName : unit >= 125 ? "Solis" : "Deye";
  const pvKw = sys ? Math.min(kwp, unit * invN * 1.3) : kwp;
  const panelLabel = sys ? `${panels} لوح ${sys.panelName} ${sys.panelW}W` : `${panels} لوح سنتك ${PANEL_W}W`;
  const batLabel = sys ? (batKwh > 0 ? `${mods} بطارية ${sys.batName} ${sys.batUnit}kWh` : "بدون بطاريات") : mods === 0 ? "بدون بطاريات" : peak <= 16 ? `${mods} بطارية Pylontech ${smallBat}kWh` : `${racks} راك × ${mods} بطارية ${BAT_MOD}kWh`;
  // منحنى الإنتاج الشمسي (جيبي من 6 إلى 18)
  const shape = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 18 ? Math.sin((Math.PI * (h + 0.5 - 6)) / 12) : 0));
  const sSum = shape.reduce((a, b) => a + b, 0);
  const pv = shape.map((s) => (pvKw * PSH * PR * s) / sSum);
  const cap = batKwh, min = cap * (1 - DOD);
  let soc = cap;
  let hours: Hour[] = [];
  for (let pass = 0; pass < 3; pass++) {
    hours = [];
    for (let h = 0; h < 24; h++) {
      const load = kw[h] ?? 0;
      const direct = Math.min(load, pv[h]!);
      let rest = load - direct, charge = 0, batOut = 0, gen = 0;
      const surplus = pv[h]! - direct;
      if (surplus > 0) { charge = Math.min(surplus, cap - soc); soc += charge; }
      if (rest > 0) { batOut = Math.min(rest, Math.max(0, soc - min)); soc -= batOut; rest -= batOut; }
      if (rest > 0.001) {
        gen = rest;
        // المولد يعيد شحن البطاريات أثناء تشغيله
        const top = Math.min(cap - soc, cap * 0.25); soc += top; gen += top;
      }
      hours.push({ h, load, pv: pv[h]!, direct, batOut, charge, gen, soc: cap > 0 ? (soc / cap) * 100 : 0 });
    }
  }
  const genE = hours.reduce((s, x) => s + x.gen, 0);
  const genHours = hours.filter((x) => x.gen > 0.001).length;
  const baseHours = kw.filter((v) => v > 0).length;
  const directE = hours.reduce((s, x) => s + x.direct, 0);
  const batE = hours.reduce((s, x) => s + x.batOut, 0);
  const sunH = hours.filter((x) => x.gen <= 0.001 && x.direct >= x.batOut && x.load > 0).length;
  return {
    total, peak, kwp, panels, panelLabel, batLabel, custom: !!sys, batKwh, mods, racks, invN, unit, invBrand, hours, genE, genHours, baseHours,
    sunH, batH: Math.max(0, baseHours - genHours - sunH),
    clean: total > 0 ? ((directE + batE) / total) * 100 : 0, solarPct: total > 0 ? (directE / total) * 100 : 0,
    capex: sys ? sys.capex : Math.round(kwp * PV_USD_KWP + batKwh * BAT_USD_KWH + invN * unit * INV_USD_KW),
  };
}

function econ(total: number, genE: number, capex: number, price: number) {
  const baseL = total / KWH_PER_L, newL = genE / KWH_PER_L, savedL = baseL - newL;
  const saving = savedL * 365 * price;
  return { baseL, newL, savedL, saving, months: saving > 0 ? (capex / saving) * 12 : null, net5: saving * 5 - capex, sav5: saving * 5, co2: (savedL * 365 * CO2_PER_L) / 1000, cut: baseL > 0 ? (savedL / baseL) * 100 : 0 };
}

function schedule(hours: Hour[]) {
  const tag = (x: Hour) => x.gen > 0.001 ? "gen" : x.pv > 0 && x.charge > 0 ? "sunc" : x.pv > 0 ? "sund" : x.load > 0 ? "bat" : "off";
  const text: Record<string, [string, string]> = {
    gen: ["المولد يغذي الحمل ويعيد شحن البطاريات", "يعمل"],
    sunc: ["الشمس مباشرة + شحن البطاريات", "المولد متوقف"],
    sund: ["الشمس + تفريغ البطاريات", "المولد متوقف"],
    bat: ["تفريغ البطاريات للأحمال", "المولد متوقف"],
    off: ["لا توجد أحمال", "متوقف"],
  };
  const segs: { from: number; to: number; k: string }[] = [];
  hours.forEach((x) => { const k = tag(x); const last = segs[segs.length - 1]; if (last && last.k === k) last.to = x.h + 1; else segs.push({ from: x.h, to: x.h + 1, k }); });
  if (segs.length > 1 && segs[0]!.k === segs[segs.length - 1]!.k) { const f = segs.shift()!; segs[segs.length - 1]!.to = f.to + 24; }
  return segs.map((s) => ({ range: `${hh(s.from)} – ${hh(s.to)}`, src: text[s.k]![0], gen: s.k === "gen" ? `${s.to - s.from} ساعات تشغيل` : text[s.k]![1], k: s.k }));
}

const R = { red: "#e60012", ink: "#14171c", sub: "#6b7280", line: "#e5e7eb", paper: "#f7f8fa", mint: "#e8f5ee", green: "#15803d" };
const LOGO = "/brand/actes-logo-report.png";

const Sec = ({ n, kicker, title, note, children }: { n: string; kicker: string; title: string; note?: string; children: React.ReactNode }) => (
  <section className="break-inside-avoid">
    <p className="text-[12px] font-black" style={{ color: R.red }}>{n} — {kicker}</p>
    <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
      <h3 className="text-2xl font-black" style={{ color: R.ink }}>{title}</h3>
      {note && <p className="max-w-md text-[12px]" style={{ color: R.sub }}>{note}</p>}
    </div>
    <div className="mt-4 rounded-xl border bg-white p-4 sm:p-6" style={{ borderColor: R.line, borderTop: `5px solid ${R.red}` }}>{children}</div>
  </section>
);

const TOTAL = 4;
const DOC_NO = `ACT-FS-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}`;
const Page = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className="report-page flex flex-col overflow-hidden rounded-xl border shadow-sm sm:aspect-[210/297]" style={{ background: R.paper, borderColor: R.line, breakAfter: n < TOTAL ? "page" : "auto" }}>
    <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3 sm:px-6" style={{ borderColor: R.line }}>
      <div className="flex items-center gap-3"><img src={LOGO} alt="ACTES" className="h-14 w-auto object-contain" /><span dir="ltr" className="hidden text-[11px] font-black tracking-wide sm:inline" style={{ color: "#4b5563" }}>ENERGY SYSTEMS & SOLUTIONS</span></div>
      <span className="rounded-md border bg-white px-3 py-1.5 text-[11px]" style={{ borderColor: R.line, color: "#4b5563" }}><i className="me-1.5 inline-block size-2 rounded-full" style={{ background: R.green }} />دراسة جدوى تنفيذية</span>
    </div>
    <div className="flex flex-1 flex-col justify-between gap-5 p-4 sm:p-5">{children}</div>
    <div className="flex items-center justify-between gap-3 border-t bg-white px-4 py-2 text-[10px] sm:px-6" style={{ borderColor: R.line, color: R.sub }}>
      <span dir="ltr" className="tabular-nums">{DOC_NO}</span>
      <span>وثيقة سرية — للاستخدام الخاص بالعميل • {new Date().toLocaleDateString("ar-EG-u-nu-latn")}</span>
      <b className="tabular-nums" style={{ color: R.ink }}>صفحة {n} من {TOTAL}</b>
    </div>
  </div>
);

const Kpi = ({ t, v, s, hot }: { t: string; v: string; s?: string | undefined; hot?: boolean }) => (
  <div className="rounded-lg border bg-white p-3.5" style={{ borderColor: hot ? "#f5a3a8" : R.line }}>
    <i className="inline-block size-2 rounded-full" style={{ background: R.green }} />
    <p className="mt-2 text-[12px] font-bold" style={{ color: "#374151" }}>{t}</p>
    <p className="mt-1 text-xl font-black tabular-nums" style={{ color: R.ink }}>{v}</p>
    {s && <p className="mt-1 text-[11px]" style={{ color: R.sub }}>{s}</p>}
  </div>
);

const W = 640, H = 220, P = { t: 12, r: 10, b: 24, l: 44 };
const X = (h: number) => P.l + ((W - P.l - P.r) * h) / 24;
function Frame({ max, unit, children }: { max: number; unit: string; children: React.ReactNode }) {
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: "ltr" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke={C.grid} strokeDasharray="3 3" />
          <text x={P.l - 4} y={y(max * f) + 3} fontSize="9" textAnchor="end" fill="#666">{nf(max * f)}{unit}</text></g>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={X(h)} y={H - 8} fontSize="9" textAnchor="middle" fill="#666">{hh(h)}</text>)}
      {children}
    </svg>
  );
}
const Legend = ({ items }: { items: [string, string][] }) => (
  <div className="mt-2 flex flex-wrap gap-3 text-[11px]">{items.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}</div>
);

export function EcoReport({ kw, price: price0, onBuy, onEdit, onSales, system, project, target, scenarioLabel, autoDownload, onDownloaded, hideActions }: { kw: number[]; price: number; system?: CustomSystem | undefined; onBuy?: (() => void) | undefined; onEdit?: (() => void) | undefined; onSales?: (() => void) | undefined; project?: string | undefined; target?: number | undefined; scenarioLabel?: string | undefined; autoDownload?: boolean | undefined; onDownloaded?: (() => void) | undefined; hideActions?: boolean | undefined }) {
  const d = useMemo(() => design(kw, system, target), [kw, system, target]);
  const e = econ(d.total, d.genE, d.capex, price0);
  const cleanKwhY = d.total * (d.clean / 100) * 365;
  const lcoe = cleanKwhY > 0 ? d.capex / (cleanKwhY * 20) : 0;
  const roi = d.capex > 0 ? (e.saving / d.capex) * 100 : 0;
  const sens = [0.7, 0.85, 1, 1.15, 1.3].map((f) => { const pr = price0 * f; const sv = e.savedL * 365 * pr; return { pr, sv, m: sv > 0 ? (d.capex / sv) * 12 : null, n5: sv * 5 - d.capex, cur: f === 1 }; });
  const sched = schedule(d.hours);
  const ref = useRef<HTMLDivElement>(null);
  const offH = 24 - d.genHours;
  const yMax = (v: number) => { const m = Math.max(v, 1); const p = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / p) * p; };
  const kMax = yMax(Math.max(d.peak, ...d.hours.map((x) => x.pv)));
  const yk = (v: number) => P.t + (H - P.t - P.b) * (1 - v / kMax);
  const step = (vals: number[], base: number[] = []) => vals.map((v, h) => `${h ? "L" : "M"}${X(h)},${yk(v + (base[h] ?? 0))} L${X(h + 1)},${yk(v + (base[h] ?? 0))}`).join(" ");
  const area = (top: number[], bot: number[]) => `${step(top)} L${X(24)},${yk(bot[23]!)} ${bot.map((_, i) => { const h = 23 - i; return `L${X(h + 1)},${yk(bot[h]!)} L${X(h)},${yk(bot[h]!)}`; }).join(" ")} Z`;
  const a1 = d.hours.map((x) => x.direct), a2 = d.hours.map((x) => x.direct + x.batOut), a3 = d.hours.map((x) => x.direct + x.batOut + Math.max(0, x.load - x.direct - x.batOut));
  const zero = Array(24).fill(0);
  const ys = (v: number) => P.t + (H - P.t - P.b) * (1 - v / 100);
  const noBat = d.batKwh <= 0;
  const fmtM = (m: number | null) => m === null ? "—" : m < 24 ? `${nf(m, 1)} شهر` : `${nf(m / 12, 1)} سنة`;

  const [busy, setBusy] = useState(false);
  const download = async () => {
    const node = ref.current; if (!node || busy) return;
    setBusy(true);
    try {
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      await document.fonts.ready;
      const pages = Array.from(node.querySelectorAll<HTMLElement>(".report-page"));
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i]!, { scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: 1000, onclone: (doc: Document) => { const st = doc.createElement("style"); st.textContent = "*{letter-spacing:0 !important;font-feature-settings:normal !important;text-rendering:geometricPrecision !important}"; doc.head.appendChild(st); } });
        const pw = 210, ph = 297, m = 6;
        let w = pw - m * 2, h = (canvas.height * w) / canvas.width;
        if (h > ph - m * 2) { h = ph - m * 2; w = (canvas.width * h) / canvas.height; }
        if (i) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (pw - w) / 2, m, w, h);
      }
      const name = (project || "ACTES").replace(/[\\/:*?"<>|]+/g, " ").trim();
      pdf.save(`دراسة_الجدوى_الاقتصادية-${name}${scenarioLabel ? `-${scenarioLabel}` : ""}.pdf`);
    } finally { setBusy(false); onDownloaded?.(); }
  };
  const started = useRef(false);
  useEffect(() => { if (autoDownload && !started.current) { started.current = true; const t = setTimeout(() => { void download(); }, 400); return () => { clearTimeout(t); started.current = false; }; } return undefined; }, [autoDownload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div ref={ref} className="space-y-5" style={{ color: R.ink }}>
        <Page n={1}>
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
            <div>
              <h2 className="text-3xl font-black leading-tight sm:text-5xl" style={{ color: R.ink }}>{project || "منظومة الطاقة الشمسية والتخزين"}</h2>
              <p className="mt-2 text-3xl font-black leading-tight sm:text-5xl" style={{ color: R.red }}>{d.custom ? "منظومة العميل" : scenarioLabel || "المنظومة المقترحة"}</p>
              <p className="mt-4 text-sm" style={{ color: R.sub }}>دراسة فنية ومالية تنفيذية مقدمة من ACTES • إصدار {new Date().getFullYear()}</p>
            </div>
            <div className="rounded-xl border bg-white p-5 shadow-md lg:order-first" style={{ borderColor: R.line, borderTop: `5px solid ${R.red}` }}>
              <p className="text-[12px] font-black" style={{ color: "#4b5563" }}>ملخص الاستثمار</p>
              {[["الاستثمار المطلوب", d.capex], ["التوفير في 5 سنوات", e.sav5], ["صافي القيمة المتحققة", e.net5]].map(([l, v]) => (
                <div key={l as string} className="flex items-center justify-between border-b py-3.5" style={{ borderColor: R.line }}><span className="text-sm" style={{ color: "#4b5563" }}>{l}</span><b className="text-xl tabular-nums">${nf(v as number)}</b></div>
              ))}
              <p className="mt-4 rounded-md py-3 text-center text-sm font-black" style={{ background: R.mint, color: R.green }}>خفض فاتورة الديزل الحالية بنسبة {nf(e.cut, 1)}%</p>
            </div>
          </div>

        <Sec n="01" kicker="لوحة المؤشرات" title="الأثر التنفيذي" note="المؤشرات الأساسية للمنظومة، محسوبة على أساس التشغيل السنوي الكامل.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Kpi hot t="إجمالي القدرة الشمسية" v={`${nf(d.kwp, 2)} kWp`} s={d.panelLabel} />
            {!noBat && <Kpi t="سعة التخزين المركبة" v={`${nf(d.batKwh)} kWh`} s={d.batLabel} />}
            <Kpi t="التغطية النظيفة" v={`${nf(d.clean)} %`} s={`من حمل يومي ${nf(d.total)} kWh`} />
            <Kpi hot t="إيقاف المولد" v={`${offH} ساعة/يوم`} s={`${nf(offH * 365)} ساعة سنوياً`} />
            <Kpi t="توفير الديزل" v={`${nf(e.savedL * 365)} لتر/سنة`} s={`≈ ${nf(e.savedL)} لتر/يوم`} />
            <Kpi hot t="التوفير المالي السنوي" v={`${nf(e.saving)} $`} s={`عند ${nf(price0, 3)} $/L`} />
            <Kpi t="التكلفة الاستثمارية" v={`${nf(d.capex)} $`} s="CAPEX" />
            <Kpi t="فترة الاسترداد" v={fmtM(e.months)} s={e.months ? `≈ ${nf(e.months / 12, 2)} سنة` : undefined} />
            <Kpi t="صافي التوفير خلال 5 سنوات" v={`${nf(e.net5)} $`} s="توفير تراكمي" />
            <Kpi t="خفض انبعاثات الكربون" v={`${nf(e.co2)} طن CO₂/سنة`} s="أثر بيئي مباشر" />
          </div>
        </Sec>
        </Page>
        <Page n={2}>

        <Sec n="02" kicker="المقارنة" title="الوضع بدون منظومة مقابل المنظومة المقترحة" note="مقارنة تفصيلية بين التشغيل على المولدات فقط والمنظومة الهجينة المقترحة.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead><tr className="bg-navy text-primary-foreground"><th className="p-2 text-right">بند المقارنة</th><th className="p-2 text-right">بدون منظومة</th><th className="p-2 text-right">المنظومة المقترحة (Solar + BESS)</th></tr></thead>
              <tbody>
                {[
                  ["نوع المنظومة", "مولدات ديزل فقط", noBat ? "منظومة شمسية On-Grid بدون بطاريات" : "منظومة هجينة متكاملة Solar + BESS"],
                  ["الألواح الشمسية", "لا يوجد", d.panelLabel],
                  ["قدرة الألواح", "0 kWp", `${nf(d.kwp, 2)} kWp`],
                  ["الإنفرترات", "لا يوجد", `${d.invN} وحدة ${d.invBrand} × ${d.unit} kW`],
                  ...(noBat ? [] : [["بطاريات الليثيوم", "لا يوجد", `${d.batLabel} — ${nf(d.batKwh)} kWh (${nf(d.batKwh * DOD)} kWh عند ${DOD * 100}% DoD)`]]),
                  ...(d.custom || noBat ? [] : [["راكات التخزين", "لا يوجد", `${d.racks} راك`]]),
                  ["ساعات تشغيل المولد", `${d.baseHours} ساعة/يوم`, `${d.genHours} ساعة/يوم (إيقاف ${offH} ساعة)`],
                  ["استهلاك الديزل اليومي", `${nf(e.baseL)} لتر`, `${nf(e.newL)} لتر/يوم`],
                  ["استهلاك الديزل السنوي", `${nf(e.baseL * 365)} لتر`, `${nf(e.newL * 365)} لتر (توفير ${nf(e.savedL * 365)} لتر)`],
                  ["التكلفة التشغيلية السنوية", `$${nf(e.baseL * 365 * price0)}`, `$${nf(e.newL * 365 * price0)} (توفير $${nf(e.saving)})`],
                  ["نسبة التغطية النظيفة", "0%", `${nf(d.clean)}% (${nf(d.solarPct)}% شمس + ${nf(d.clean - d.solarPct)}% بطاريات)`],
                  ["خفض انبعاثات CO₂", "خط الأساس", `${nf(e.co2)} طن/سنة`],
                  ["الاستثمار المطلوب", "$0", `$${nf(d.capex)} — استرداد خلال ${fmtM(e.months)}`],
                ].map(([a, b, c], i) => (
                  <tr key={a} className={i % 2 ? "bg-muted/40" : ""}><td className="p-2 font-bold">{a}</td><td className="p-2 text-muted-foreground">{b}</td><td className="p-2 font-bold text-navy">{c}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>

        <Sec n="03" kicker="تحليل الحساسية" title="أثر تغيّر سعر الديزل على الجدوى" note="مصفوفة السيناريوهات عند أسعار ديزل مختلفة بنفس المنظومة والحمل.">
          <table className="w-full text-xs">
            <thead><tr className="bg-navy text-primary-foreground"><th className="p-2 text-right">سعر اللتر</th><th className="p-2 text-right">التوفير السنوي</th><th className="p-2 text-right">فترة الاسترداد</th><th className="p-2 text-right">صافي 5 سنوات</th></tr></thead>
            <tbody>{sens.map((r) => (
              <tr key={r.pr} className="border-b border-border" style={r.cur ? { background: R.mint, fontWeight: 900 } : undefined}><td className="p-2 tabular-nums">${nf(r.pr, 3)}{r.cur ? " (الحالي)" : ""}</td><td className="p-2 tabular-nums">${nf(r.sv)}</td><td className="p-2">{fmtM(r.m)}</td><td className="p-2 tabular-nums">${nf(r.n5)}</td></tr>
            ))}</tbody>
          </table>
        </Sec>
        </Page>
        <Page n={3}>
        <Sec n="04" kicker="برنامج التشغيل" title="الفترات التشغيلية اليومية" note={`توزيع مصادر التغذية على مدار اليوم: ${d.sunH} ساعات شمس مباشرة، ${d.batH} ساعات بطاريات، ${d.genHours} ساعات مولد.`}>
          <table className="w-full text-xs">
            <thead><tr className="bg-navy text-primary-foreground"><th className="p-2 text-right">الفترة</th><th className="p-2 text-right">مصادر التغذية / النشاط</th><th className="p-2 text-right">حالة المولد</th></tr></thead>
            <tbody>{sched.map((s) => (
              <tr key={s.range} className="border-b border-border"><td className="p-2 font-bold tabular-nums" dir="ltr">{s.range}</td><td className="p-2"><i className="me-1.5 inline-block size-2 rounded-full" style={{ background: s.k === "gen" ? C.gen : s.k === "bat" ? C.bat : C.sun }} />{s.src}</td><td className={`p-2 font-bold ${s.k === "gen" ? "text-destructive" : "text-energy"}`}>{s.gen}</td></tr>
            ))}</tbody>
          </table>
        </Sec>

        <Sec n="05" kicker="ساعات التغطية" title="كم تكفي المنظومة نهاراً وليلاً؟">
          <div className="grid gap-4 lg:grid-cols-2">
            <table className="w-full text-xs">
              <tbody>{[
                ["ساعات التغطية النهارية (شمس مباشرة)", `${d.sunH} ساعات — ${nf(d.kwp, 1)} kWp`],
                ...(noBat ? [] : [["ساعات التغطية الليلية (تفريغ البطاريات)", `${d.batH} ساعات — ${nf(d.batKwh * DOD)} kWh صافي`]]),
                ["ساعات الاستغناء التام عن المولد", `${offH} ساعة/يوم`],
                ["ساعات تشغيل المولد المتبقية", `${d.genHours} ساعات/يوم`],
                ["نسبة الاستغناء عن المولد من اليوم", `${nf((offH / 24) * 100, 1)}%`],
                ["ساعات إراحة المولد سنوياً", `${nf(offH * 365)} ساعة/سنة`],
              ].map(([a, b]) => <tr key={a} className="border-b border-border"><td className="p-2">{a}</td><td className="p-2 font-bold text-navy">{b}</td></tr>)}</tbody>
            </table>
            <div>
              <p className="text-xs font-black">توزيع ساعات اليوم حسب المصدر</p>
              {[["بدون منظومة", 0, 0, d.baseHours], ["المنظومة المقترحة", d.sunH, d.batH, d.genHours]].map(([l, s, b, g]) => (
                <div key={l as string} className="mt-3">
                  <p className="mb-1 text-[11px] font-bold">{l}</p>
                  <div className="flex h-7 overflow-hidden rounded text-[10px] font-bold text-primary-foreground">
                    {[[s, C.sun], [b, C.bat], [g, C.gen]].map(([v, c], i) => (v as number) > 0 && <div key={i} style={{ width: `${((v as number) / 24) * 100}%`, background: c as string }} className="grid place-items-center">{v as number}h</div>)}
                  </div>
                </div>
              ))}
              <Legend items={[[C.sun, "شمس نهاراً"], ...(noBat ? [] : [[C.bat, "بطاريات ليلاً"] as [string, string]]), [C.gen, "تشغيل المولد"]]} />
            </div>
          </div>
        </Sec>

        <Sec n="06" kicker="الوقود والمولد" title="أثر المنظومة على الديزل وساعات المولد">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-black">استهلاك الديزل اليومي (لتر)</p>
              <div className="mt-2 flex h-36 items-end gap-6 border-b border-border px-6">
                {[["بدون منظومة", e.baseL, C.gen], ["المنظومة المقترحة", e.newL, C.bat]].map(([l, v, c]) => (
                  <div key={l as string} className="flex flex-1 flex-col items-center gap-1"><b className="text-xs tabular-nums">{nf(v as number)}</b><div className="w-full rounded-t" style={{ height: `${Math.max(2, ((v as number) / Math.max(e.baseL, 1)) * 120)}px`, background: c as string }} /><span className="text-[10px]">{l as string}</span></div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-black">ساعات المولد ونسبة الطاقة النظيفة</p>
              <div className="mt-2 flex h-36 items-end gap-3 border-b border-border px-4">
                {[["ساعات المولد — بدون", (d.baseHours / 24) * 100, `${d.baseHours}h`, C.gen], ["ساعات المولد — مقترحة", (d.genHours / 24) * 100, `${d.genHours}h`, C.gen], ["طاقة نظيفة %", d.clean, `${nf(d.clean)}%`, C.bat]].map(([l, v, t, c]) => (
                  <div key={l as string} className="flex flex-1 flex-col items-center gap-1"><b className="text-xs">{t as string}</b><div className="w-full rounded-t" style={{ height: `${Math.max(2, ((v as number) / 100) * 120)}px`, background: c as string }} /><span className="text-center text-[10px]">{l as string}</span></div>
                ))}
              </div>
            </div>
          </div>
        </Sec>
        </Page>
        <Page n={4}>
        <Sec n="07" kicker="تغطية الأحمال" title="تغطية الحمل على مدار 24 ساعة" note={`طاقة نظيفة ${nf(d.clean)}% • المولد ${d.genHours} ساعة/يوم`}>
          <Frame max={kMax} unit="">
            <path d={area(a3, a2)} fill={C.gen} opacity={0.75} />
            <path d={area(a2, a1)} fill={C.bat} opacity={0.8} />
            <path d={area(a1, zero)} fill={C.sun} opacity={0.85} />
            <path d={step(d.hours.map((x) => x.load))} fill="none" stroke={C.load} strokeWidth={1.8} />
          </Frame>
          <Legend items={[[C.sun, "شمس مباشرة"], ...(noBat ? [] : [[C.bat, "البطاريات"] as [string, string]]), [C.gen, "المولد"], [C.load, "الحمل (kW)"]]} />
        </Sec>
        <div className={noBat ? "" : "grid gap-5 lg:grid-cols-2"}>
        {!noBat && <Sec n="08" kicker="أداء البطاريات" title="حالة شحن البطاريات" note="منحنى شحن وتفريغ البطاريات خلال 24 ساعة.">
          <div>
            <div>
              <p className="text-xs font-black">حالة شحن البطاريات — 24 ساعة</p>
              <p className="text-[10px] text-muted-foreground">الحد الأدنى الآمن 10% وفق عمق تفريغ 90% • السعة القابلة للاستخدام {nf(d.batKwh * DOD)} kWh</p>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: "ltr" }}>
                {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={ys(v)} y2={ys(v)} stroke={C.grid} strokeDasharray="3 3" /><text x={P.l - 4} y={ys(v) + 3} fontSize="9" textAnchor="end" fill="#666">{v}%</text></g>)}
                {[0, 4, 8, 12, 16, 20].map((h) => <text key={h} x={X(h)} y={H - 8} fontSize="9" textAnchor="middle" fill="#666">{hh(h)}</text>)}
                <path d={`M${X(0)},${ys(d.hours[23]!.soc)} ${d.hours.map((x) => `L${X(x.h + 1)},${ys(x.soc)}`).join(" ")} L${X(24)},${ys(0)} L${X(0)},${ys(0)} Z`} fill={C.bat} opacity={0.15} />
                <path d={`M${X(0)},${ys(d.hours[23]!.soc)} ${d.hours.map((x) => `L${X(x.h + 1)},${ys(x.soc)}`).join(" ")}`} fill="none" stroke={C.bat} strokeWidth={2.2} />
                <line x1={P.l} x2={W - P.r} y1={ys(10)} y2={ys(10)} stroke={C.gen} strokeDasharray="5 3" />
                <text x={W - P.r - 4} y={ys(10) - 4} fontSize="9" textAnchor="end" fill={C.gen}>10%</text>
              </svg>
            </div>
          </div>
        </Sec>}
        <Sec n={noBat ? "08" : "09"} kicker="الإنتاج الشمسي" title="الإنتاج الشمسي مقابل الحمل">
          <div>
              <p className="text-[11px] text-muted-foreground">المساحة الخضراء تمثل الفائض الشمسي المستخدم في شحن البطاريات • ذروة الإنتاج {nf(Math.max(...d.hours.map((x) => x.pv)))} / ذروة الحمل {nf(d.peak)} kW</p>
              <Frame max={kMax} unit="">
                <path d={area(d.hours.map((x) => x.pv), d.hours.map((x) => Math.min(x.pv, x.load)))} fill={C.bat} opacity={0.35} />
                <path d={step(d.hours.map((x) => x.pv))} fill="none" stroke={C.sun} strokeWidth={2} />
                <path d={step(d.hours.map((x) => x.load))} fill="none" stroke={C.load} strokeWidth={2} />
              </Frame>
              <Legend items={[[C.sun, "الإنتاج الشمسي"], [C.load, "حمل المنشأة"], [C.bat, "فائض للشحن"]]} />
          </div>
        </Sec>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
          {[["إعداد المهندس المختص", "الاسم / التوقيع"], ["اعتماد ACTES", "الختم الرسمي"], ["موافقة العميل", "الاسم / التوقيع / التاريخ"]].map(([t, s2]) => (
            <div key={t} className="rounded-lg border bg-white p-3" style={{ borderColor: R.line }}><p className="text-[12px] font-black">{t}</p><div className="mt-10 border-t border-dashed pt-1 text-[10px]" style={{ borderColor: R.sub, color: R.sub }}>{s2}</div></div>
          ))}
        </div>
        <p className="text-center text-[11px]" style={{ color: R.sub }}>الأرقام تقديرية: {PSH} ساعات ذروة شمسية، {KWH_PER_L} kWh لكل لتر ديزل.</p>
        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4" style={{ background: R.ink }}>
          <div className="flex items-center gap-3"><span className="rounded bg-white px-2 py-1"><img src={LOGO} alt="ACTES" className="h-12 w-auto" /></span><b dir="ltr" className="text-sm" style={{ color: "#fff" }}>ACTES Energy Systems & Solutions</b></div>
          <span className="text-[12px]" style={{ color: "#9ca3af" }}>من إعداد شركة أكتس لأنظمة الطاقة وحلولها</span>
        </footer>
        </Page>
      </div>

      {!hideActions && <div className="flex flex-wrap gap-2" data-noprint>
        <button type="button" onClick={() => void download()} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-navy px-5 py-3 text-sm font-black text-primary-foreground disabled:opacity-60"><Download className="size-4" /> {busy ? "جارٍ التحميل..." : "تحميل التقرير PDF"}</button>
        {onBuy && <button type="button" onClick={onBuy} className="inline-flex items-center gap-2 rounded-md border border-border bg-card text-foreground hover:border-energy px-5 py-3 text-sm font-black transition"><ShoppingCart className="size-4 text-energy" />متابعة الشراء</button>}
        {onEdit && <button type="button" onClick={onEdit} className="rounded-md border border-border px-4 py-2 text-xs font-bold">رجوع</button>}
        {onSales && <button type="button" onClick={onSales} className="rounded-md border border-border px-4 py-2 text-xs font-bold">تواصل مع فريق أكتس</button>}
      </div>}
    </div>
  );
}

/** ملخص سريع لسيناريو بنسبة تغطية مستهدفة — يُستخدم في بطاقات السيناريوهات. */
export function ecoSummary(kw: number[], price: number, target: number) {
  const d = design(kw, undefined, target);
  const e = econ(d.total, d.genE, d.capex, price);
  return { kwp: d.kwp, panelLabel: d.panelLabel, batKwh: d.batKwh, batLabel: d.batLabel, inv: `${d.invN} × ${d.invBrand} ${d.unit} kW`, invKw: d.unit * d.invN, capex: d.capex, saving: e.saving, months: e.months, cut: e.cut, savedL: e.savedL * 365, offH: 24 - d.genHours, peak: d.peak, total: d.total };
}

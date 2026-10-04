import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShoppingCart, X, FileText, Download } from "lucide-react";
import { EcoReport, ecoSummary, type CustomSystem } from "./eco-report";
import { speakScreen } from "@/lib/voice-guide";
import { LoadPdfImport } from "./load-pdf-import";

/** يعيد التمرير إلى رأس الشاشة عند الانتقال بين خطوات الدراسة. */
function toTop() {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0 });
  document.querySelectorAll<HTMLElement>("main").forEach((m) => { m.scrollTop = 0; });
}

// دراسة الجدوى الاقتصادية: 24 خانة (ديزل لتر/ساعة أو أحمال kW) ثم 3 سيناريوهات للمنظومة
type Mode = "diesel" | "loads";

const PSH = 5.5; // ساعات الذروة الشمسية في اليمن
const PR = 0.8; // نسبة أداء المنظومة
const KWH_PER_L = 3.3; // كيلوواط ساعة لكل لتر ديزل في المولدات
const PV_USD_KWP = 450; // ألواح + تركيب لكل kWp
const BAT_USD_KWH = 300; // بطاريات ليثيوم لكل kWh
const INV_USD_KW = 150; // انفرتر هجين لكل kW
const DOD = 0.9;
const YEARS = 25;
const DEG = 0.005;
const OM = 0.01;
const DAY = (h: number) => h >= 7 && h < 17;

const hourLabel = (h: number) => {
  const f = (x: number) => (x % 12 === 0 ? 12 : x % 12);
  return `من ${f(h)} إلى ${f(h + 1)} ${h < 12 ? "صباحاً" : "مساءً"}`;
};
const nf = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

const PROJECT_KEY = "actes_eco_project";
const DAY_SHARE = [1, 1, 1, 1, 1, 1.2, 1.6, 2.4, 3, 3.2, 3.3, 3.3, 3.2, 3.2, 3.2, 3.1, 2.9, 2.6, 2.4, 2.2, 1.9, 1.6, 1.3, 1.1];

type Goal = "reduce" | "free";
const GOALS: Record<Goal, { title: string; note: string; levels: { t: number; label: string; note: string }[] }> = {
  reduce: {
    title: "تقليل استهلاك الديزل", note: "خفض تكلفة التشغيل مع بقاء المولد للفترات الليلية",
    levels: [
      { t: 0.35, label: "توفير 35%", note: "منظومة نهارية اقتصادية بأقل استثمار" },
      { t: 0.55, label: "توفير 55%", note: "منظومة متوازنة مع تخزين خفيف" },
      { t: 0.7, label: "توفير 70%", note: "تغطية النهار كاملاً وبداية المساء" },
    ],
  },
  free: {
    title: "الاستغناء عن الديزل", note: "استقلالية عالية والمولد احتياط فقط",
    levels: [
      { t: 0.8, label: "استقلالية 80%", note: "المولد يعمل ساعات قليلة فجراً" },
      { t: 0.9, label: "استقلالية 90%", note: "شبه استغناء كامل عن المولد" },
      { t: 1, label: "استقلالية 100%", note: "منظومة مستقلة والمولد للطوارئ فقط" },
    ],
  },
};

function ReportModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-black">تقرير دراسة الجدوى الاقتصادية</p>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-md border border-border p-1.5"><X className="size-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 sm:p-6"><div className="mx-auto max-w-[1000px]">{children}</div></div>
    </div>,
    document.body,
  );
}

/** شاشة اسم الجهة: أول خطوة في دراسة الجدوى، ويُعتمد الاسم في ترويسة التقرير واسم الملف. */
function ProjectNameForm({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void }) {
  const types = ["مصنع", "شركة", "مؤسسة", "مزرعة", "فندق", "مستشفى", "مجمع سكني", "منزل"];
  return (
    <form onSubmit={(e) => { e.preventDefault(); const n = value.trim(); if (n) onSubmit(n); }} className="rounded-lg border border-border bg-muted/35 p-5">
      <p className="text-sm font-black">بيانات الجهة صاحبة المشروع</p>
      <p className="mt-1 text-xs leading-6 text-muted-foreground">يرجى كتابة الاسم الرسمي للمشروع أو الشركة أو المصنع، ليُعتمد في ترويسة تقرير دراسة الجدوى واسم الملف.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {types.map((t) => (
          <button key={t} type="button" onClick={() => { const v = value.trim(); onChange(v.startsWith(t) ? v : `${t} ${v.replace(new RegExp(`^(${types.join("|")})\\s*`), "")}`.trimEnd() + " "); }} className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-bold hover:border-primary">{t}</button>
        ))}
      </div>
      <label className="mt-3 grid gap-1">
        <span className="text-xs font-bold">اسم المشروع / الشركة / المصنع</span>
        <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} placeholder="مثال: مصنع أرض الخليج للبلاستيك" className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm" />
      </label>
      <button type="submit" disabled={!value.trim()} className="mt-3 w-full rounded-md bg-skyline px-6 py-3 text-sm font-bold text-skyline-foreground disabled:opacity-50 sm:w-auto">متابعة</button>
    </form>
  );
}

export function EcoFeasibility({ mode, onSales, onBuy }: { mode: Mode; onSales?: () => void; onBuy?: (loads: string) => void }) {
  const [step, setStep] = useState<"name" | "data" | "goal" | "result">("name");
  const [project, setProject] = useState("");
  useEffect(() => { try { setProject(sessionStorage.getItem(PROJECT_KEY) ?? ""); } catch { /* ignore */ } }, []);
  const [values, setValues] = useState<string[]>(() => Array(24).fill(""));
  const [price, setPrice] = useState("1.1");
  const [same, setSame] = useState(false);
  const [daily, setDaily] = useState("");
  const [goal, setGoal] = useState<Goal>("reduce");
  const [pick, setPick] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [dl, setDl] = useState<number | null>(null);
  useEffect(() => { toTop(); }, [step]);
  useEffect(() => {
    if (step === "name") return; // شاشة الاسم ينطقها مسار المحادثة نفسه
    const t = step === "data"
      ? (mode === "diesel" ? "بَيَانَاتُ الدِّيزِل. اكْتُبِ اسْتِهْلَاكَ المُوَلِّدِ بِاللِّتْرِ لِكُلِّ سَاعَة، أَوِ اكْتُبِ الاسْتِهْلَاكَ اليَوْمِيَّ وَاضْغَطْ تَوْزِيعَ عَلَى السَّاعَات." : "بَيَانَاتُ الأَحْمَال. اكْتُبِ الحِمْلَ بِالكِيلُووَاط لِكُلِّ سَاعَة، أَوِ اكْتُبِ الحِمْلَ اليَوْمِيَّ وَاضْغَطْ تَوْزِيعَ عَلَى السَّاعَات.")
      : step === "goal"
        ? "مَا هَدَفُكَ مِنَ المَنْظُومَة؟ تَقْلِيلُ اسْتِهْلَاكِ الدِّيزِل، أَوِ الاسْتِغْنَاءُ عَنِ الدِّيزِل."
        : `${goal === "reduce" ? "تَقْلِيلُ اسْتِهْلَاكِ الدِّيزِل" : "الاسْتِغْنَاءُ عَنِ الدِّيزِل"}. هَذِهِ ثَلَاثَةُ سِينَارْيُوهَاتٍ مُنَاسِبَةٍ لِمَشْرُوعِك. يُمْكِنُكَ فَتْحُ التَّقْرِيرِ الكَامِلِ أَوْ تَحْمِيلُه، أَوْ مُتَابَعَةُ الشِّرَاء.`;
    speakScreen(`eco|${mode}|${step}|${goal}`, t);
  }, [step, goal, mode]);
  const filled = values.filter((v) => v.trim() !== "" && !isNaN(Number(v))).length;
  const unit = mode === "diesel" ? "لتر/ساعة" : "kW";
  const kw = useMemo(() => values.map((v) => { const n = Math.max(0, Number(v) || 0); return mode === "diesel" ? n * KWH_PER_L : n; }), [values, mode]);
  const dp = Math.max(0, Number(price) || 0);
  const levels = GOALS[goal].levels;
  const sums = useMemo(() => levels.map((l) => ecoSummary(kw, dp, l.t)), [kw, dp, levels]);
  const loadsText = () => kw.map((v, h) => `${h}: ${Math.round(v * 100) / 100}`).join("\n");
  const tier = (p: number) => (p <= 16 ? "سكنية" : p <= 100 ? "تجارية" : "تجارية / صناعية");

  const distribute = () => {
    const tot = Math.max(0, Number(daily) || 0); if (!tot) return;
    const s = DAY_SHARE.reduce((a, b) => a + b, 0);
    setSame(false);
    setValues(DAY_SHARE.map((w) => String(Math.round(((tot * w) / s) * 100) / 100)));
  };

  if (step === "name") {
    return <ProjectNameForm value={project} onChange={setProject} onSubmit={(n) => { try { sessionStorage.setItem(PROJECT_KEY, n); } catch { /* ignore */ } setStep("data"); }} />;
  }

  if (step === "data") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (filled === 24) setStep("goal"); }} className="rounded-lg border border-border bg-muted/35 p-5">
        <p className="text-sm font-black">{mode === "diesel" ? "بيانات الديزل" : "بيانات الاحمال"} — {project}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "diesel" ? "اكتب استهلاك المولد من الديزل في كل ساعة باللتر — اكتب 0 للساعات التي لا يعمل فيها" : "اكتب الحمل المتوقع في كل ساعة بالكيلووات (kW) — اكتب 0 للساعات بلا أحمال"}
        </p>
        {mode === "loads" && <LoadPdfImport onApply={(v, c) => { setSame(false); setValues(v); if (c?.trim()) { setProject(c.trim()); try { sessionStorage.setItem(PROJECT_KEY, c.trim()); } catch { /* ignore */ } } }} />}
        <div className="mt-3 rounded-md border border-dashed border-border bg-background p-3">
          <p className="text-xs font-bold">{mode === "diesel" ? "أو اكتب استهلاك الديزل اليومي" : "أو اكتب الحمل اليومي الكلي"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative w-44">
              <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="0" className="w-full rounded-md border border-border bg-background px-3 py-2 pe-16 text-sm tabular-nums" />
              <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-[10px] text-muted-foreground">{mode === "diesel" ? "لتر/يوم" : "kWh/يوم"}</span>
            </div>
            <button type="button" onClick={distribute} disabled={!(Number(daily) > 0)} className="rounded-md bg-navy px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">توزيع على الساعات</button>
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={same} onChange={(e) => { const on = e.target.checked; setSame(on); if (on) { const v = values.find((x) => x.trim() !== "") ?? ""; setValues(Array(24).fill(v)); } }} className="size-4 accent-primary" />
          اعتماد نفس القيمة لكل الساعات
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {values.map((v, i) => (
            <label key={i} className="grid gap-1">
              <span className="text-[11px] font-bold text-muted-foreground">{hourLabel(i)}</span>
              <div className="relative">
                <input inputMode="decimal" value={v} onChange={(e) => { const val = e.target.value; setValues((p) => same ? Array(24).fill(val) : p.map((x, j) => (j === i ? val : x))); }} className="w-full rounded-md border border-border bg-background px-3 py-2 pe-14 text-sm tabular-nums" placeholder="0" />
                <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-[10px] text-muted-foreground">{unit}</span>
              </div>
            </label>
          ))}
        </div>
        <label className="mt-4 grid max-w-xs gap-1">
          <span className="text-xs font-bold">سعر لتر الديزل بالدولار</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums" />
        </label>
        <p className="mt-3 text-xs text-muted-foreground">تم إدخال {filled} من 24 خانة</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" disabled={filled !== 24} className="rounded-md bg-skyline px-6 py-3 text-sm font-bold text-skyline-foreground disabled:opacity-50">متابعة</button>
          <button type="button" onClick={() => setStep("name")} className="rounded-md border border-border px-4 py-2 text-xs font-bold">رجوع</button>
        </div>
      </form>
    );
  }

  if (step === "goal") {
    return (
      <div className="rounded-lg border border-border bg-muted/35 p-5">
        <p className="text-sm font-black">ما هدفك من المنظومة؟</p>
        <p className="mt-1 text-xs text-muted-foreground">اختر الهدف لنعرض لك ثلاثة سيناريوهات مناسبة لمشروع {project}.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(Object.keys(GOALS) as Goal[]).map((g) => (
            <button key={g} type="button" onClick={() => { setGoal(g); setPick(1); setStep("result"); }} className="rounded-lg border border-border bg-background p-4 text-start transition hover:border-primary">
              <p className="text-sm font-black">{GOALS[g].title}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{GOALS[g].note}</p>
              <p className="mt-2 text-[11px] font-bold text-primary">{GOALS[g].levels.map((l) => `${Math.round(l.t * 100)}%`).join(" • ")}</p>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setStep("data")} className="mt-4 rounded-md border border-border px-4 py-2 text-xs font-bold">رجوع</button>
      </div>
    );
  }

  const reportFor = (i: number, extra: { autoDownload?: boolean; onDownloaded?: () => void; hideActions?: boolean }) => (
    <EcoReport kw={kw} price={dp} project={project} target={levels[i]!.t} scenarioLabel={levels[i]!.label} onSales={onSales} {...extra} />
  );
  const s = sums[pick]!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black">{GOALS[goal].title} — {project}</p>
          <p className="text-[11px] text-muted-foreground">حمل يومي {nf(s.total, 1)} kWh • اختر السيناريو المناسب</p>
        </div>
        <button type="button" onClick={() => setStep("goal")} className="rounded-md border border-border px-3 py-1.5 text-xs font-bold">تغيير الهدف</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {levels.map((l, i) => {
          const x = sums[i]!;
          const on = pick === i;
          return (
            <div key={l.t} role="button" tabIndex={0} onClick={() => setPick(i)} onKeyDown={(e) => { if (e.key === "Enter") setPick(i); }} className={`cursor-pointer rounded-lg border p-4 transition ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-black">{l.label}</p>
                <span className={`size-4 rounded-full border-2 ${on ? "border-primary bg-primary" : "border-border"}`} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{l.note}</p>
              <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-[10px] font-bold">منظومة {tier(x.peak)}</p>
              <dl className="mt-3 space-y-1.5 text-xs">
                {[
                  ["الألواح", `${nf(x.kwp, 2)} kWp`],
                  ["", x.panelLabel],
                  ["الانفرتر", x.inv],
                  ["البطاريات", x.batKwh > 0 ? `${nf(x.batKwh, 1)} kWh` : "بدون"],
                  ["الديزل الموفّر", `${nf(x.savedL)} لتر/سنة`],
                  ["التوفير السنوي", `${nf(x.saving)} $`],
                  ["التكلفة التقديرية", `${nf(x.capex)} $`],
                  ["فترة الاسترداد", x.months === null ? "—" : x.months < 24 ? `${nf(x.months, 1)} شهر` : `${nf(x.months / 12, 1)} سنة`],
                ].map(([k, v], j) => (
                  <div key={j} className="flex justify-between gap-2 border-b border-border/60 pb-1"><dt className="text-muted-foreground">{k}</dt><dd className="text-end font-bold tabular-nums">{v}</dd></div>
                ))}
              </dl>
              <p className="mt-3 text-[11px] font-bold text-muted-foreground">التقرير الكامل</p>
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(i); }} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-bold hover:border-primary"><FileText className="size-3.5" /> فتح</button>
                <button type="button" disabled={dl !== null} onClick={(e) => { e.stopPropagation(); setDl(i); }} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-navy px-2 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-60"><Download className="size-3.5" /> {dl === i ? "جارٍ..." : "تحميل"}</button>
              </div>
            </div>
          );
        })}
      </div>
      {onBuy && (
        <button type="button" onClick={() => onBuy(`${loadsText()}\nproject: ${project}\nscenario: ${levels[pick]!.label} — ${nf(s.kwp, 2)} kWp / ${nf(s.batKwh, 1)} kWh / ${s.inv}`)} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-foreground hover:border-energy px-6 py-3 text-sm font-black transition"><ShoppingCart className="size-4 text-energy" />
          متابعة الشراء — {levels[pick]!.label}
        </button>
      )}
      <p className="text-[11px] text-muted-foreground">الأرقام تقديرية: {PSH} ساعات ذروة شمسية، {KWH_PER_L} kWh لكل لتر ديزل، وأسعار معدات متوسطة. السعر النهائي يُحدد في عرض السعر.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStep("data")} className="rounded-md border border-border px-4 py-2 text-xs font-bold">تعديل البيانات</button>
        {onSales && <button type="button" onClick={onSales} className="rounded-md border border-border px-4 py-2 text-xs font-bold">تواصل مع فريق أكتس</button>}
      </div>
      {open !== null && <ReportModal onClose={() => setOpen(null)}>{reportFor(open, {})}</ReportModal>}
      {dl !== null && (
        <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 1000, pointerEvents: "none" }}>
          {reportFor(dl, { autoDownload: true, hideActions: true, onDownloaded: () => setDl(null) })}
        </div>
      )}
    </div>
  );
}

/** دراسة جدوى لمنظومة جاهزة حدد العميل سعرها — بلا طلب عرض سعر. */
export function EcoSystemStudy({ onSales }: { onSales?: () => void }) {
  const [f, setF] = useState({ panel: "", panelW: "", panelN: "", inv: "", invKw: "", invN: "", bat: "", batKwh: "", batN: "", cost: "", price: "1.1" });
  const [done, setDone] = useState(false);
  const [project, setProject] = useState("");
  const [named, setNamed] = useState(false);
  useEffect(() => { try { setProject(sessionStorage.getItem(PROJECT_KEY) ?? ""); } catch { /* ignore */ } }, []);
  useEffect(() => { toTop(); }, [done, named]);
  const [lm, setLm] = useState<"none" | "loads" | "diesel">("none");
  const [hrs, setHrs] = useState<string[]>(() => Array(24).fill(""));
  const [total, setTotal] = useState("");
  const [one, setOne] = useState("");
  const [showReport, setShowReport] = useState(false);
  const n = (v: string) => Math.max(0, Number(v) || 0);
  const kwp = (n(f.panelW) * n(f.panelN)) / 1000;
  const invKw = n(f.invKw) * n(f.invN);
  const batKwh = n(f.batKwh) * n(f.batN);
  const capex = n(f.cost);
  const dp = n(f.price);
  const ok = f.panel.trim() && kwp > 0 && f.inv.trim() && invKw > 0 && capex > 0;
  // الإنتاج اليومي محدود بقدرة الانفرتر
  const dailyKwh = Math.min(kwp, invKw * 1.3) * PSH * PR;
  const yearKwh = dailyKwh * 365;
  // توزيع الإجمالي اليومي بنمط واقعي: ساعات النهار ضعف الليل
  const spread = (t: number) => { const w = Array.from({ length: 24 }, (_, h) => (DAY(h) ? 2 : 1)); const s = w.reduce((a, b) => a + b, 0); return w.map((x) => String(Math.round((t * x / s) * 100) / 100)); };
  const loadKw = hrs.map((v) => n(v) * (lm === "diesel" ? KWH_PER_L : 1));
  const loadDay = loadKw.reduce((a, b) => a + b, 0);
  const useLoads = lm !== "none" && loadDay > 0;
  let covered = dailyKwh;
  if (useLoads) {
    const sun = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 18 ? Math.sin(((h - 6 + 0.5) / 12) * Math.PI) : 0));
    const ss = sun.reduce((a, b) => a + b, 0);
    let direct = 0, excess = 0;
    sun.forEach((s, h) => { const p = (dailyKwh * s) / ss; direct += Math.min(p, (loadKw[h] ?? 0)); excess += Math.max(0, p - (loadKw[h] ?? 0)); });
    const night = loadDay - direct;
    covered = direct + Math.min(excess * 0.9, batKwh * DOD, night);
  }
  const coverage = useLoads ? Math.round((covered / loadDay) * 100) : null;
  const liters = Math.round((covered * 365) / KWH_PER_L);
  const saving = Math.round(liters * dp * 1.1);
  let cum = -capex; let payback: number | null = null;
  const rows: { y: number; cum: number }[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const net = saving * Math.pow(1 - DEG, y - 1) - capex * OM;
    const prev = cum; cum += net; rows.push({ y, cum: Math.round(cum) });
    if (payback === null && prev < 0 && cum >= 0 && net > 0) payback = y - 1 + Math.abs(prev) / net;
  }
  // الأحمال للتقرير: أحمال العميل إن وُجدت، وإلا حمل افتراضي يساوي إنتاج المنظومة اليومي
  const reportKw = useLoads ? loadKw : spread(Math.max(1, dailyKwh)).map(Number);
  const sys: CustomSystem = { panelName: f.panel, panelW: n(f.panelW), panels: n(f.panelN), invName: f.inv, invKw: n(f.invKw), invN: n(f.invN), batName: f.bat, batUnit: n(f.batKwh), batN: n(f.batN), capex };
  const roi = capex > 0 ? Math.round((cum / capex) * 100) : 0;
  const QUICK: Partial<Record<keyof typeof f, [string, string]>> = {
    panel: ["Suntech 720W", "Suntech 595W"], panelW: ["720", "595"],
    inv: ["Deye", "Solis"], invKw: ["12", "50"],
    bat: ["Pylontech", "HiTHIUM"], batKwh: ["5.12", "16"],
  };
  const field = (k: keyof typeof f, label: string, ph: string, num = false, opt = false) => (
    <label className="grid gap-1">
      <span className="text-xs font-bold">{label}{opt && <span className="text-muted-foreground"> (اختياري)</span>}</span>
      {QUICK[k] && (
        <span className="grid grid-cols-2 gap-1.5">
          {QUICK[k]!.map((q) => (
            <button key={q} type="button" onClick={() => setF({ ...f, [k]: q })} className={`rounded-md border px-2 py-1.5 text-xs font-bold transition ${f[k] === q ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card hover:border-brand/50"}`}>{q}</button>
          ))}
        </span>
      )}
      <input inputMode={num ? "decimal" : "text"} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
    </label>
  );

  if (!named) {
    return <ProjectNameForm value={project} onChange={setProject} onSubmit={(v) => { setProject(v); try { sessionStorage.setItem(PROJECT_KEY, v); } catch { /* ignore */ } setNamed(true); }} />;
  }

  if (!done) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (ok) setDone(true); }} className="rounded-lg border border-border bg-muted/35 p-5">
        <p className="text-sm font-black">بيانات المنظومة — {project}</p>
        <p className="mt-1 text-xs text-muted-foreground">اكتب مكونات منظومتك الجاهزة وتكلفتها لنحسب جدواها الاقتصادية.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {field("panel", "اسم اللوح", "Suntech")}
          {field("panelW", "قدرة اللوح (W)", "720", true)}
          {field("panelN", "عدد الألواح", "20", true)}
          {field("inv", "اسم الانفرتر", "Deye")}
          {field("invKw", "قدرة الانفرتر (kW)", "12", true)}
          {field("invN", "عدد الانفرترات", "1", true)}
          {field("bat", "اسم البطارية", "Pylontech", false, true)}
          {field("batKwh", "سعة البطارية (kWh)", "5", true, true)}
          {field("batN", "عدد البطاريات", "2", true, true)}
          {field("cost", "تكلفة المنظومة ($)", "10000", true)}
          {field("price", "سعر لتر الديزل ($)", "1.1", true)}
        </div>
        <div className="mt-5 rounded-md border border-border bg-background p-4">
          <p className="text-xs font-black">بيانات الأحمال <span className="font-normal text-muted-foreground">(اختياري — لحساب التغطية والتوفير الفعلي)</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([["none", "بدون"], ["loads", "بيانات الأحمال (kW)"], ["diesel", "بيانات الديزل (لتر/ساعة)"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setLm(k)} className={`rounded-md border px-3 py-1.5 text-xs font-bold ${lm === k ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{l}</button>
            ))}
          </div>
          <LoadPdfImport onApply={(v, c) => { setLm("loads"); setHrs(v); if (c?.trim()) { setProject(c.trim()); try { sessionStorage.setItem(PROJECT_KEY, c.trim()); } catch { /* ignore */ } } }} />
          {lm !== "none" && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1"><span className="text-xs font-bold">الإجمالي ليوم واحد ({lm === "diesel" ? "لتر/يوم" : "kWh/يوم"})</span>
                  <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={lm === "diesel" ? "120" : "400"} className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
                <button type="button" disabled={!n(total)} onClick={() => setHrs(spread(n(total)))} className="rounded-md bg-skyline px-3 py-2 text-xs font-bold text-skyline-foreground disabled:opacity-50">توزيع على الـ 24 ساعة</button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1"><span className="text-xs font-bold">قيمة واحدة لكل ساعة ({lm === "diesel" ? "لتر/ساعة" : "kW"})</span>
                  <input inputMode="decimal" value={one} onChange={(e) => setOne(e.target.value)} className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
                <button type="button" disabled={!n(one)} onClick={() => setHrs(Array(24).fill(one))} className="rounded-md border border-border px-3 py-2 text-xs font-bold disabled:opacity-50">اعتماد نفس القيمة لكل الساعات</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {hrs.map((v, h) => (
                  <label key={h} className="grid gap-0.5 text-[10px] text-muted-foreground">{String(h).padStart(2, "0")}:00
                    <input inputMode="decimal" value={v} onChange={(e) => setHrs(hrs.map((x, i) => (i === h ? e.target.value : x)))} className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" /></label>
                ))}
              </div>
            </div>
          )}
        </div>
        <button type="submit" disabled={!ok} className="mt-4 w-full rounded-md bg-skyline px-6 py-3 text-sm font-bold text-skyline-foreground disabled:opacity-50 sm:w-auto">احسب الجدوى الاقتصادية</button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/35 p-4 text-sm">
        <p className="font-black">منظومتك</p>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
          <div>الألواح<br /><b>{f.panel} — {f.panelN} × {f.panelW}W = {nf(kwp, 2)} kWp</b></div>
          <div>الانفرتر<br /><b>{f.inv} — {f.invN} × {f.invKw} kW</b></div>
          <div>البطاريات<br /><b>{batKwh > 0 ? `${f.bat} — ${f.batN} × ${f.batKwh} kWh` : "بدون"}</b></div>
          <div>التكلفة<br /><b className="tabular-nums">{nf(capex)} $</b></div>
        </div>
      </div>
      <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
        <p className="text-sm font-black">نتائج الجدوى الاقتصادية</p>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {[
            ["الإنتاج اليومي المتوقع", `${nf(dailyKwh, 1)} kWh`],
            ["الإنتاج السنوي", `${nf(yearKwh)} kWh`],
            ...(useLoads ? [["الحمل اليومي", `${nf(loadDay, 1)} kWh`], ["نسبة تغطية الحمل", `${coverage}%`]] : []),
            ["الديزل الموفّر سنوياً", `${nf(liters)} لتر`],
            ["التوفير السنوي", `${nf(saving)} $`],
            ["فترة الاسترداد", payback ? `${Math.round(payback * 10) / 10} سنة` : "—"],
            [`صافي الربح خلال ${YEARS} سنة`, `${nf(cum)} $`],
            ["العائد على الاستثمار", `${roi}%`],
            ["تكلفة الواط", kwp > 0 ? `${nf(capex / (kwp * 1000), 2)} $/W` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-border/60 pb-1"><dt className="text-muted-foreground">{k}</dt><dd className="font-bold tabular-nums">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 grid grid-cols-5 gap-1 text-center text-[10px] sm:grid-cols-10">
          {rows.filter((r) => r.y % 5 === 0 || r.y <= 5).map((r) => (
            <div key={r.y} className={`rounded p-1 ${r.cum >= 0 ? "bg-energy/15" : "bg-muted"}`}>سنة {r.y}<br /><b className="tabular-nums">{nf(r.cum)}</b></div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">الأرقام تقديرية: {PSH} ساعات ذروة شمسية، نسبة أداء {PR * 100}%، {KWH_PER_L} kWh لكل لتر ديزل، وتدهور سنوي {DEG * 100}%.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowReport(true)} className="inline-flex items-center gap-2 rounded-md bg-navy px-5 py-2.5 text-xs font-black text-primary-foreground"><FileText className="size-4" /> فتح تقرير الدراسة الاقتصادية</button>
        <button type="button" onClick={() => setDone(false)} className="rounded-md border border-border px-4 py-2 text-xs font-bold">تعديل البيانات</button>
        {onSales && <button type="button" onClick={onSales} className="rounded-md border border-border px-4 py-2 text-xs font-bold">تواصل مع فريق أكتس</button>}
      </div>
      {showReport && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-navy/80 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <FileText className="size-4 shrink-0 text-brand" />
              <span className="flex-1 truncate text-xs font-black text-navy lg:text-sm">تقرير دراسة الجدوى الاقتصادية — ACTES</span>
              <button type="button" onClick={() => setShowReport(false)} aria-label="إغلاق" className="grid size-7 place-items-center rounded-full bg-muted text-navy transition hover:bg-border"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-auto bg-muted p-2 sm:p-4">
              <EcoReport kw={reportKw} price={dp} project={project} system={sys} onEdit={() => { setShowReport(false); setDone(false); }} onSales={onSales} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

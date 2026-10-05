import { createFileRoute } from "@tanstack/react-router";
import { EcoReport } from "@/components/eco-report";

const kw = [129.7, 123.3, 109.4, 106.7, 99.0, 99.1, 85.6, 85.6, 93.6, 112.4, 124.3, 124.1, 105.1, 118.4, 141.2, 159.5, 177.1, 160.9, 169.9, 139.1, 151.4, 147.5, 154.9, 155.5];
const sys = { panelName: "Suntech STP720S-D66/Nsh+", panelW: 720, panels: 576, invName: "Pylontech 125kW", invKw: 125, invN: 3, batName: "Pylontech OPTIM US L260-HY-M7", batUnit: 260, batN: 3, capex: 279183 };

export const Route = createFileRoute("/tmp-print")({
  component: () => <div dir="rtl"><EcoReport kw={kw} price={1.1} project="مصنع أرض الخليج للبلاستيك" system={sys} hideActions /></div>,
});

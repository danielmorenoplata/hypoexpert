import { useState, useEffect } from "react";

// ============================================================
// EASYMORTGAGE - Calculateur de capacité hypothécaire
// MVP v1 — Québec/Canada
// ============================================================

// --- Paramètres mis à jour manuellement par le courtier ---
const RATES = {
  marketFixe: 0.042,        // Taux fixe du marché
  marketVariable: 0.043,    // Taux variable du marché
  bocFloor: 0.0525,         // Taux plancher Banque du Canada
};
const STRESS_ADD = 0.02;    // +2% pour le stress test
const DEFAULT_HOUSING = {
  hydro: 100,
  taxes: 350,
  condo: 0,
};

// --- Ratios d'endettement selon cote de crédit ---
const RATIOS = {
  A: { gds: 0.35, tds: 0.42, label: "Sous 680" },
  B: { gds: 0.39, tds: 0.44, label: "680 et plus" },
};

// ============================================================
// Logique de calcul (reproduit l'Excel du courtier)
// ============================================================
function parseNum(v) {
  const n = parseFloat(String(v).replace(/\s|,/g, ""));
  return isNaN(n) ? 0 : n;
}

function paymentPer1000(annualRate, years) {
  // Hypothèque canadienne: capitalisation semi-annuelle, paiement mensuel
  const periodic = Math.pow(1 + annualRate / 2, 2 / 12) - 1;
  const n = 12 * years;
  return (1000 * periodic) / (1 - Math.pow(1 + periodic, -n));
}

function calculate(data) {
  // 1. Revenu total annuel
  // Travailleur autonome : si revenu 2025 < revenu 2024 → prendre 2025 seulement
  //                        si revenu 2025 >= revenu 2024 → prendre la moyenne
  const revA2024 = parseNum(data.revASelfemp2023); // champ label "2024"
  const revA2025 = parseNum(data.revASelfemp2024); // champ label "2025"
  const selfempA = revA2025 < revA2024 ? revA2025 : (revA2024 + revA2025) / 2;

  const revB2024 = parseNum(data.revBSelfemp2023);
  const revB2025 = parseNum(data.revBSelfemp2024);
  const selfempB = data.hasConjoint
    ? (revB2025 < revB2024 ? revB2025 : (revB2024 + revB2025) / 2)
    : 0;
  const totalIncome =
    parseNum(data.revASalary) +
    selfempA +
    (data.hasConjoint ? parseNum(data.revBSalary) : 0) +
    selfempB +
    parseNum(data.rentalMonthly) * 12 / 2 +
    parseNum(data.childCanadaMonthly) * 12 +
    parseNum(data.childQCquarterly) * 4;

  // 2. Dettes annuelles
  const totalDebtsAnnual =
    parseNum(data.autoMonthly) * 12 +
    parseNum(data.studentMonthly) * 12 +
    parseNum(data.ccBalance) * 0.05 * 12 +
    parseNum(data.otherDebtsMonthly) * 12;

  // 3. Ratios selon cote
  const score = data.creditScore || "A";
  const { gds: gdsRatio, tds: tdsRatio } = RATIOS[score];

  // 4. Capacité mensuelle pour logement (la plus serrée entre ABD/ATD)
  // Si dettes > TDS (tdsAvail < 0) → on tombe sur le GDS seulement (formule Excel: SI(tdsAvail<0; gdsMax/12; MIN(gdsMax,tdsAvail)/12))
  const tdsMax = totalIncome * tdsRatio;
  const gdsMax = totalIncome * gdsRatio;
  const tdsAvail = tdsMax - totalDebtsAnnual;
  const maxMonthlyHousing = tdsAvail < 0
    ? gdsMax / 12
    : Math.min(gdsMax, tdsAvail) / 12;

  // 5. Paiement hypothécaire max (on soustrait frais de logement)
  const maxMonthlyMortgage =
    maxMonthlyHousing - DEFAULT_HOUSING.hydro - DEFAULT_HOUSING.taxes - DEFAULT_HOUSING.condo;

  // 6. Taux de qualification (stress test)
  const mFixe = (parseNum(data.marketFixe) || RATES.marketFixe * 100) / 100;
  const mVar  = (parseNum(data.marketVariable) || RATES.marketVariable * 100) / 100;
  const bFloor = (parseNum(data.bocFloor) || RATES.bocFloor * 100) / 100;
  const qualFixe = Math.max(bFloor, mFixe + STRESS_ADD);
  const qualVar  = Math.max(bFloor, mVar  + STRESS_ADD);

  // 7. Prêt max (4 scénarios)
  const scenarios = {
    fixe25: maxMonthlyMortgage > 0 ? (maxMonthlyMortgage / paymentPer1000(qualFixe, 25)) * 1000 : 0,
    var25: maxMonthlyMortgage > 0 ? (maxMonthlyMortgage / paymentPer1000(qualVar, 25)) * 1000 : 0,
    fixe30: maxMonthlyMortgage > 0 ? (maxMonthlyMortgage / paymentPer1000(qualFixe, 30)) * 1000 : 0,
    var30: maxMonthlyMortgage > 0 ? (maxMonthlyMortgage / paymentPer1000(qualVar, 30)) * 1000 : 0,
  };

  return {
    totalIncome,
    totalDebtsAnnual,
    maxMonthlyHousing,
    maxMonthlyMortgage,
    hydro: DEFAULT_HOUSING.hydro,
    taxes: DEFAULT_HOUSING.taxes,
    condo: DEFAULT_HOUSING.condo,
    bocFloor: bFloor,
    marketFixe: mFixe,
    marketVariable: mVar,
    qualFixe,
    qualVar,
    scenarios,
    qualified: maxMonthlyMortgage > 0 && totalIncome > 0,
  };
}

// ============================================================
// Formatage
// ============================================================
function fmtMoney(n) {
  if (!isFinite(n) || n <= 0) return "0 $";
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMoneyPrecise(n) {
  if (!isFinite(n)) return "0 $";
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}

// ============================================================
// Main App
// ============================================================
export default function HypoExpert() {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    revASalary: "",
    revAIsSelfemp: false,
    revASelfemp2023: "",
    revASelfemp2024: "",
    hasConjoint: false,
    revBSalary: "",
    revBIsSelfemp: false,
    revBSelfemp2023: "",
    revBSelfemp2024: "",
    rentalMonthly: "",
    childCanadaMonthly: "",
    childQCquarterly: "",
    autoMonthly: "",
    studentMonthly: "",
    ccBalance: "",
    otherDebtsMonthly: "",
    creditScore: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    consent: false,
    marketFixe: 4.20,
    marketVariable: 4.30,
    bocFloor: 5.25,
  });

  const TOTAL_STEPS = 7; // intro + 5 questions + results (lead is modal)
  const progress = step === 0 ? 0 : Math.min((step / (TOTAL_STEPS - 1)) * 100, 100);

  const update = (patch) => setData((d) => ({ ...d, ...patch }));
  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  const results = calculate(data);

  return (
    <div className="min-h-screen w-full bg-stone-50 text-slate-900 font-body">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap');
        .font-display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; }
        .font-body { font-family: 'Manrope', system-ui, -apple-system, sans-serif; }
        .tabular { font-variant-numeric: tabular-nums; }
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-in { animation: fadeSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade { animation: fadeIn 0.6s ease-out; }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-20 bg-stone-50/90 backdrop-blur border-b border-stone-200">
        <div className="max-w-xl mx-auto px-5 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-900 rounded-md flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-stone-50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12l9-9 9 9"/>
                  <path d="M5 10v10h14V10"/>
                </svg>
              </div>
              <div className="leading-tight">
                <div className="font-display font-semibold text-[15px] text-blue-900 tracking-tight">HypoExpert</div>
                <div className="text-[10px] text-slate-500 -mt-0.5 uppercase tracking-wider">Québec · Canada</div>
              </div>
            </div>
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <div className="text-[13px] font-semibold text-slate-800">Ronny Aguilera</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Courtier hypothécaire · Représentant autonome · <a href="https://lautorite.qc.ca/grand-public/registres/registre-des-courtiers-en-hypotheques" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900 transition">AMF 177112</a></div>
              <div className="text-[10px] text-slate-400">205-6424 rue Jean-Talon E., Montréal, QC H1S 1M8</div>
              <div className="flex items-center gap-3 mt-0.5">
                <a href="tel:5146595104" className="text-[11px] text-blue-900 font-medium">514 659-5104</a>
                <a href="mailto:ronny.aguilera@groupeih.ca" className="text-[11px] text-blue-900 font-medium">ronny.aguilera@groupeih.ca</a>
              </div>
            </div>
            {step > 0 && step < 6 && (
              <button
                onClick={back}
                className="text-sm text-slate-500 hover:text-blue-900 transition"
              >
                ← Retour
              </button>
            )}
          </div>
          {step > 0 && (
            <div className="mt-3 h-[3px] bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-900 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </header>

      {/* Modal Politique de confidentialité */}
      {showPrivacy && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowPrivacy(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-semibold text-slate-900">Politique de confidentialité</h2>
              <button onClick={() => setShowPrivacy(false)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="text-sm text-slate-600 space-y-4 leading-relaxed">
              <p><strong className="text-slate-900">Responsable du traitement</strong><br />Ronny Aguilera, courtier hypothécaire (représentant autonome), AMF 177112<br />205-6424 rue Jean-Talon E., Montréal, QC H1S 1M8<br /><a href="tel:5146595104" className="text-blue-900">514 659-5104</a> · <a href="mailto:ronny.aguilera@groupeih.ca" className="text-blue-900">ronny.aguilera@groupeih.ca</a></p>
              <p><strong className="text-slate-900">Données collectées</strong><br />Nom, adresse courriel, numéro de téléphone, et les informations financières saisies dans le calculateur (revenus, dettes, cote de crédit estimée).</p>
              <p><strong className="text-slate-900">Finalité</strong><br />Ces données sont collectées dans le seul but de vous fournir une analyse hypothécaire personnalisée et de vous contacter dans le cadre de cette demande.</p>
              <p><strong className="text-slate-900">Partage des données</strong><br />Vos informations ne sont jamais vendues, louées ni partagées avec des tiers à des fins commerciales. Elles peuvent être transmises à des institutions financières uniquement avec votre consentement explicite, dans le cadre d'une demande de financement.</p>
              <p><strong className="text-slate-900">Conservation</strong><br />Vos données sont conservées pendant une période maximale de 2 ans suivant votre demande, conformément aux exigences réglementaires de l'AMF, puis supprimées de façon sécuritaire.</p>
              <p><strong className="text-slate-900">Vos droits</strong><br />Vous pouvez en tout temps demander l'accès, la rectification ou la suppression de vos données en contactant <a href="mailto:ronny.aguilera@groupeih.ca" className="text-blue-900">ronny.aguilera@groupeih.ca</a>.</p>
              <p><strong className="text-slate-900">Sécurité</strong><br />Ce site utilise une connexion sécurisée (HTTPS). Aucune donnée de carte de crédit n'est collectée.</p>
              <p className="text-xs text-slate-400">Dernière mise à jour : mai 2026</p>
            </div>
            <button onClick={() => setShowPrivacy(false)} className="mt-6 w-full bg-blue-900 text-white rounded-xl py-3 font-semibold text-sm hover:bg-blue-800 transition">Fermer</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-xl mx-auto px-5 pb-32 pt-8">
        {step === 0 && <Intro onStart={next} data={data} update={update} />}
        {step === 1 && <RevenusPrincipal data={data} update={update} onNext={next} />}
        {step === 2 && <RevenusConjoint data={data} update={update} onNext={next} />}
        {step === 3 && <Allocations data={data} update={update} onNext={next} />}
        {step === 4 && <Dettes data={data} update={update} onNext={next} />}
        {step === 5 && <CoteCredit data={data} update={update} onNext={next} />}
        {step === 6 && <Resultats results={results} onContinue={() => setStep(7)} />}
        {step === 7 && <LeadCapture data={data} update={update} onSubmit={() => setStep(8)} results={results} onShowPrivacy={() => setShowPrivacy(true)} />}
        {step === 8 && <DetailHypotheque results={results} onNext={() => setStep(9)} />}
        {step === 9 && <Merci data={data} />}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-stone-50/80 backdrop-blur-sm border-t border-stone-200">
        <div className="max-w-xl mx-auto px-5 py-2 flex flex-col sm:flex-row items-center justify-between gap-1">
          <span className="text-[10px] text-slate-500">
            <span className="font-semibold text-slate-700">Ronny Aguilera</span> · Courtier hypothécaire · Représentant autonome · AMF 177112 · 205-6424 rue Jean-Talon E., Montréal, QC H1S 1M8 · <a href="tel:5146595104" className="pointer-events-auto text-blue-900">514 659-5104</a> · <a href="mailto:ronny.aguilera@groupeih.ca" className="pointer-events-auto text-blue-900">ronny.aguilera@groupeih.ca</a>
          </span>
          <span className="text-[10px] text-slate-400 text-center">
            Résultats à titre indicatif seulement · Ne constitue pas une pré-approbation · Des conditions s'appliquent ·{" "}
            <button onClick={() => setShowPrivacy(true)} className="pointer-events-auto underline hover:text-blue-900 transition">Confidentialité</button>
          </span>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Étape 0 — Intro
// ============================================================
function Intro({ onStart, data, update }) {
  const [showRates, setShowRates] = useState(false);
  return (
    <div className="animate-in pt-4">
      <div className="mb-10">
        <div className="text-xs uppercase tracking-[0.2em] text-blue-900/70 mb-6 font-medium">
          Calculateur hypothécaire
        </div>
        <h1 className="font-display font-normal text-5xl leading-[1.02] tracking-tight text-slate-900 mb-6">
          Quelle est votre <em className="text-blue-900 italic">véritable</em> capacité d'emprunt?
        </h1>
        <p className="text-base text-slate-600 leading-relaxed max-w-md">
          Répondez à quelques questions et obtenez en 2 minutes une estimation précise de ce que les banques canadiennes vous accorderaient pour un prêt hypothécaire.
        </p>
      </div>

      <div className="space-y-3 mb-10">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-blue-900 text-stone-50 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">1</div>
          <div>
            <div className="font-semibold text-sm text-slate-900">Vos revenus et dettes</div>
            <div className="text-sm text-slate-500">Salaires, allocations, paiements mensuels</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-blue-900 text-stone-50 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">2</div>
          <div>
            <div className="font-semibold text-sm text-slate-900">Votre cote de crédit</div>
            <div className="text-sm text-slate-500">Simple: avez-vous plus ou moins de 680?</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-blue-900 text-stone-50 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">3</div>
          <div>
            <div className="font-semibold text-sm text-slate-900">Votre capacité d'emprunt</div>
            <div className="text-sm text-slate-500">4 scénarios: fixe/variable sur 25 ou 30 ans</div>
          </div>
        </div>
      </div>

      <PrimaryButton onClick={onStart}>Commencer · 2 minutes</PrimaryButton>

      <p className="text-xs text-slate-400 mt-6 leading-relaxed">
        Vos données sont confidentielles et utilisées uniquement pour produire votre estimation. Respecte les normes canadiennes (test de simulation, ratios ABD/ATD, assurance SCHL).
      </p>

      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-xs text-amber-800 leading-relaxed">
          Les taux d'intérêt affichés sur cette plateforme sont fournis à titre indicatif seulement et sont basés sur une moyenne du marché. Le taux final peut varier selon le profil du client et les conditions des prêteurs.
        </p>
      </div>

      {/* Paramètres courtier */}
      <div className="mt-8 border-t border-stone-200 pt-6">
        <button
          onClick={() => setShowRates(!showRates)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-blue-900 transition"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Paramètres courtier — Taux du marché
        </button>

        {showRates && (
          <div className="mt-4 bg-white border border-stone-200 rounded-xl p-4 space-y-4 animate-in">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Taux actuels du marché</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fixe (%)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="15"
                  value={data.marketFixe}
                  onChange={(e) => update({ marketFixe: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm tabular focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Variable (%)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="15"
                  value={data.marketVariable}
                  onChange={(e) => update({ marketVariable: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm tabular focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Plancher BdC (%)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="15"
                  value={data.bocFloor}
                  onChange={(e) => update({ bocFloor: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm tabular focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Taux de qualification = max(Plancher BdC, Taux du marché + 2%)</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Étape 1 — Revenus principal
// ============================================================
function RevenusPrincipal({ data, update, onNext }) {
  return (
    <div className="animate-in">
      <StepHeader
        kicker="Étape 1 de 5"
        title="Parlez-nous de vos revenus"
        subtitle="Entrez votre revenu brut annuel (avant impôts)."
      />

      <div className="space-y-5">
        <CurrencyInput
          label="Revenu d'emploi salarié (annuel)"
          value={data.revASalary}
          onChange={(v) => update({ revASalary: v })}
          placeholder="0"
          helper="Laissez à 0 si vous êtes travailleur autonome uniquement"
        />

        <CurrencyInput
          label="Revenu locatif"
          value={data.rentalMonthly}
          onChange={(v) => update({ rentalMonthly: v })}
          suffix="/ mois"
          helper="Les banques comptent 50% du revenu locatif (× 12 ÷ 2)"
        />

        <Toggle
          label="Je suis aussi travailleur autonome"
          checked={data.revAIsSelfemp}
          onChange={(v) => update({ revAIsSelfemp: v })}
        />

        {data.revAIsSelfemp && (
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3 animate-in">
            <div className="text-xs text-slate-500">
              Les banques utilisent la <strong>moyenne des 2 dernières années</strong> de revenus autonomes (net/déclaré).
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CurrencyInput
                label="Revenu net 2024"
                value={data.revASelfemp2023}
                onChange={(v) => update({ revASelfemp2023: v })}
                compact
              />
              <CurrencyInput
                label="Revenu net 2025"
                value={data.revASelfemp2024}
                onChange={(v) => update({ revASelfemp2024: v })}
                compact
              />
            </div>
          </div>
        )}
      </div>

      <PrimaryButton className="mt-8" onClick={onNext}>Suivant</PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 2 — Conjoint
// ============================================================
function RevenusConjoint({ data, update, onNext }) {
  return (
    <div className="animate-in">
      <StepHeader
        kicker="Étape 2 de 5"
        title="Avez-vous un co-emprunteur?"
        subtitle="Un conjoint ou une autre personne qui emprunte avec vous augmente votre capacité."
      />

      <div className="grid grid-cols-2 gap-3 mb-6">
        <ChoiceCard
          selected={data.hasConjoint === false}
          onClick={() => update({ hasConjoint: false })}
          title="Non"
          subtitle="Seul"
        />
        <ChoiceCard
          selected={data.hasConjoint === true}
          onClick={() => update({ hasConjoint: true })}
          title="Oui"
          subtitle="À deux"
        />
      </div>

      {data.hasConjoint && (
        <div className="space-y-5 animate-in">
          <CurrencyInput
            label="Revenu d'emploi salarié du co-emprunteur"
            value={data.revBSalary}
            onChange={(v) => update({ revBSalary: v })}
          />

          <Toggle
            label="Le co-emprunteur est aussi travailleur autonome"
            checked={data.revBIsSelfemp}
            onChange={(v) => update({ revBIsSelfemp: v })}
          />

          {data.revBIsSelfemp && (
            <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3 animate-in">
              <div className="grid grid-cols-2 gap-3">
                <CurrencyInput
                  label="Revenu net 2024"
                  value={data.revBSelfemp2023}
                  onChange={(v) => update({ revBSelfemp2023: v })}
                  compact
                />
                <CurrencyInput
                  label="Revenu net 2025"
                  value={data.revBSelfemp2024}
                  onChange={(v) => update({ revBSelfemp2024: v })}
                  compact
                />
              </div>
            </div>
          )}
        </div>
      )}

      <PrimaryButton className="mt-8" onClick={onNext}>Suivant</PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 3 — Allocations familiales
// ============================================================
function Allocations({ data, update, onNext }) {
  return (
    <div className="animate-in">
      <StepHeader
        kicker="Étape 3 de 5"
        title="Allocations pour enfants"
        subtitle="Si vous en recevez. Sinon, laissez à 0."
      />

      <div className="space-y-5">
        <CurrencyInput
          label="Allocation canadienne pour enfants"
          value={data.childCanadaMonthly}
          onChange={(v) => update({ childCanadaMonthly: v })}
          suffix="/ mois"
          helper="Le montant mensuel que vous recevez du fédéral"
        />

        <CurrencyInput
          label="Allocation famille du Québec"
          value={data.childQCquarterly}
          onChange={(v) => update({ childQCquarterly: v })}
          suffix="/ trimestre"
          helper="Le montant reçu à chaque versement (4 fois par année)"
        />
      </div>

      <PrimaryButton className="mt-8" onClick={onNext}>Suivant</PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 4 — Dettes
// ============================================================
function Dettes({ data, update, onNext }) {
  return (
    <div className="animate-in">
      <StepHeader
        kicker="Étape 4 de 5"
        title="Vos dettes actuelles"
        subtitle="Entrez vos paiements mensuels. Laissez à 0 si vous n'en avez pas."
      />

      <div className="space-y-5">
        <CurrencyInput
          label="Paiement auto"
          value={data.autoMonthly}
          onChange={(v) => update({ autoMonthly: v })}
          suffix="/ mois"
        />

        <CurrencyInput
          label="Prêt étudiant"
          value={data.studentMonthly}
          onChange={(v) => update({ studentMonthly: v })}
          suffix="/ mois"
        />

        <CurrencyInput
          label="Solde total cartes de crédit et marges"
          value={data.ccBalance}
          onChange={(v) => update({ ccBalance: v })}
          helper="Les banques calculent 5% du solde comme paiement mensuel présumé"
        />

        <CurrencyInput
          label="Autres dettes (marge, prêt personnel, etc.)"
          value={data.otherDebtsMonthly}
          onChange={(v) => update({ otherDebtsMonthly: v })}
          suffix="/ mois"
        />
      </div>

      <PrimaryButton className="mt-8" onClick={onNext}>Suivant</PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 5 — Cote de crédit
// ============================================================
function CoteCredit({ data, update, onNext }) {
  return (
    <div className="animate-in">
      <StepHeader
        kicker="Étape 5 de 5"
        title="Votre cote de crédit"
        subtitle="Le seuil de 680 Equifax détermine vos ratios d'endettement admissibles."
      />

      <div className="space-y-3">
        <ChoiceRow
          selected={data.creditScore === "B"}
          onClick={() => update({ creditScore: "B" })}
          title="680 et plus"
          subtitle="Bonne à excellente cote"
          detail="Ratios: 39% logement / 44% total"
        />
        <ChoiceRow
          selected={data.creditScore === "A"}
          onClick={() => update({ creditScore: "A" })}
          title="Sous 680"
          subtitle="Cote à améliorer"
          detail="Ratios: 35% logement / 42% total"
        />
        <ChoiceRow
          selected={data.creditScore === "A" && !data.creditScore}
          onClick={() => update({ creditScore: "A" })}
          title="Je ne sais pas"
          subtitle="Nous utiliserons l'estimation la plus prudente"
          detail="Ratios: 35% / 42%"
        />
      </div>

      <div className="mt-6 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
        <strong className="text-blue-900">Astuce:</strong> Vous pouvez consulter votre cote gratuitement sur Credit Karma, Borrowell ou directement auprès d'Equifax.
      </div>

      <PrimaryButton
        className="mt-8"
        onClick={onNext}
        disabled={!data.creditScore}
      >
        Voir mes résultats
      </PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 6 — Résultats
// ============================================================
function Resultats({ results, onContinue }) {
  const [housing, setHousing] = useState({
    hydro: results.hydro,
    taxes: results.taxes,
    condo: results.condo,
  });

  // Recalcul en temps réel quand hydro/taxes/condo changent
  const localMortgage = results.maxMonthlyHousing - housing.hydro - housing.taxes - housing.condo;
  const localScenarios = {
    fixe25: localMortgage > 0 ? (localMortgage / paymentPer1000(results.qualFixe, 25)) * 1000 : 0,
    var25:  localMortgage > 0 ? (localMortgage / paymentPer1000(results.qualVar,  25)) * 1000 : 0,
    fixe30: localMortgage > 0 ? (localMortgage / paymentPer1000(results.qualFixe, 30)) * 1000 : 0,
    var30:  localMortgage > 0 ? (localMortgage / paymentPer1000(results.qualVar,  30)) * 1000 : 0,
  };

  const [displayed, setDisplayed] = useState(0);
  const topAmount = localScenarios.fixe30;

  useEffect(() => {
    if (!results.qualified) return;
    let start = null;
    const duration = 1200;
    const animate = (t) => {
      if (!start) start = t;
      const elapsed = t - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(topAmount * eased);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [topAmount, results.qualified]);

  if (!results.qualified) {
    return (
      <div className="animate-in text-center pt-8">
        <div className="font-display text-3xl mb-4">Résultats non concluants</div>
        <p className="text-slate-600 mb-8">
          Avec les informations fournies, nous ne pouvons pas calculer une capacité d'emprunt positive. Il se peut que vos dettes dépassent le ratio maximum admissible.
        </p>
        <p className="text-sm text-slate-500">
          Un courtier peut vous aider à optimiser votre dossier. Continuez pour recevoir une consultation gratuite et sans engagement.
        </p>
        <PrimaryButton className="mt-8" onClick={onContinue}>Parler à un courtier — gratuit & sans engagement</PrimaryButton>
      </div>
    );
  }

  return (
    <div className="animate-in">

      {/* ── 1. QUALIFICATION ── */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 mb-6">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4">Qualification</div>

        {/* Décomposition paiement mensuel */}
        <div className="space-y-3 mb-5">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-slate-900">Paiement mensuel total</span>
            <span className="text-sm tabular font-bold text-slate-900">{fmtMoneyPrecise(results.maxMonthlyHousing)}</span>
          </div>

          {/* Hydroquébec — éditable */}
          <div className="flex items-center gap-3 pl-3 border-l-2 border-yellow-400">
            <span className="text-sm text-slate-600 flex-1">Hydroquébec</span>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={housing.hydro}
                onChange={(e) => setHousing(h => ({ ...h, hydro: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-stone-200 rounded-lg pl-7 pr-2 py-1.5 text-sm tabular text-right focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
          </div>

          {/* Taxes — éditable */}
          <div className="flex items-center gap-3 pl-3 border-l-2 border-yellow-400">
            <span className="text-sm text-slate-600 flex-1">Taxes mun. &amp; scol.</span>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={housing.taxes}
                onChange={(e) => setHousing(h => ({ ...h, taxes: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-stone-200 rounded-lg pl-7 pr-2 py-1.5 text-sm tabular text-right focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
          </div>

          {/* Condo — éditable */}
          <div className="flex items-center gap-3 pl-3 border-l-2 border-yellow-400">
            <span className="text-sm text-slate-600 flex-1">Frais condo (50%)</span>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={housing.condo}
                onChange={(e) => setHousing(h => ({ ...h, condo: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-stone-200 rounded-lg pl-7 pr-2 py-1.5 text-sm tabular text-right focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-stone-200">
            <span className="text-sm font-bold text-orange-700">Paiement hypothécaire</span>
            <span className="text-base tabular font-bold text-orange-700">{fmtMoneyPrecise(localMortgage)}</span>
          </div>
        </div>

        {/* Taux BdC */}
        <div className="flex justify-between items-center bg-stone-50 rounded-lg px-4 py-2 mb-4">
          <span className="text-sm text-slate-600">Taux de qualification — Banque du Canada</span>
          <span className="text-sm tabular font-bold text-slate-900">{(results.bocFloor * 100).toFixed(2)} %</span>
        </div>

        {/* Table taux marché vs qualification */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div />
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1">FIXE</div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1">VARIABLE</div>

          <div className="text-sm text-slate-600 text-left self-center">Taux du marché</div>
          <div className="border-2 border-stone-300 rounded-lg py-2 text-sm font-bold tabular">
            {(results.marketFixe * 100).toFixed(2)} %
          </div>
          <div className="border-2 border-stone-300 rounded-lg py-2 text-sm font-bold tabular">
            {(results.marketVariable * 100).toFixed(2)} %
          </div>

          <div className="text-sm text-slate-600 text-left self-center">Taux de qualification</div>
          <div className="bg-orange-500 rounded-lg py-2 text-sm font-bold tabular text-white">
            {(results.qualFixe * 100).toFixed(2)} %
          </div>
          <div className="bg-orange-500 rounded-lg py-2 text-sm font-bold tabular text-white">
            {(results.qualVar * 100).toFixed(2)} %
          </div>
        </div>
      </div>

      {/* ── 2. ESTIMATION ── */}
      <div className="text-xs uppercase tracking-[0.2em] text-blue-900/70 mb-4 font-medium text-center">
        Votre estimation
      </div>

      <div className="text-center mb-2">
        <div className="text-slate-600 text-sm mb-2">Jusqu'à</div>
        <div className="font-display text-6xl text-blue-900 tracking-tight tabular font-normal">
          {fmtMoney(displayed)}
        </div>
        <div className="text-slate-500 text-sm mt-2">en prêt hypothécaire (30 ans fixe)</div>
      </div>

      <div className="my-8 h-px bg-stone-200" />

      <div className="mb-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-3 font-semibold">
          Les 4 scénarios
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ScenarioCard label="Fixe"     years="25 ans" amount={localScenarios.fixe25} rate={results.qualFixe} />
          <ScenarioCard label="Variable" years="25 ans" amount={localScenarios.var25}  rate={results.qualVar} />
          <ScenarioCard label="Fixe"     years="30 ans" amount={localScenarios.fixe30} rate={results.qualFixe} highlight />
          <ScenarioCard label="Variable" years="30 ans" amount={localScenarios.var30}  rate={results.qualVar} />
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3 mb-6">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Détails du calcul</div>
        <DetailRow label="Revenu annuel total" value={fmtMoney(results.totalIncome)} />
        <DetailRow label="Dettes annuelles" value={fmtMoney(results.totalDebtsAnnual)} />
        <DetailRow label="Paiement hypothécaire mensuel" value={fmtMoneyPrecise(localMortgage)} />
        <DetailRow label="Taux de qualification (fixe)" value={`${(results.qualFixe * 100).toFixed(2).replace(".", ",")} %`} subtle />
      </div>

      <div className="bg-blue-900 text-stone-50 rounded-xl p-5 mb-4">
        <div className="font-display text-lg mb-1">Prêt à aller plus loin?</div>
        <div className="text-sm text-blue-100 mb-4">
          Recevez votre analyse détaillée et un plan d'action personnalisé par votre courtier hypothécaire.
        </div>
        <button
          onClick={onContinue}
          className="w-full bg-stone-50 text-blue-900 font-semibold rounded-lg py-3 hover:bg-white transition"
        >
          Obtenir mon analyse complète →
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-2">
        <p className="text-xs text-amber-800 leading-relaxed text-center font-medium">
          Résultats à titre indicatif seulement. Ces chiffres ne constituent pas une offre de financement ni une pré-approbation. Une analyse complète par un courtier hypothécaire est requise. Des conditions s'appliquent.
        </p>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed text-center">
        Calcul conforme aux normes canadiennes : test de simulation au taux qualificatif (taux du marché + 2 %), ratios ABD/ATD, mise de fonds minimum 5 %.
      </p>
    </div>
  );
}

// ============================================================
// Étape 7 — Détail hypothèque
// ============================================================
const SCHL_RATES = [
  { label: "5%",   pct: 0.05, schlRate: 0.040 },
  { label: "10%",  pct: 0.10, schlRate: 0.031 },
  { label: "15%",  pct: 0.15, schlRate: 0.028 },
  { label: "20%+", pct: 0.20, schlRate: 0     },
];

// Calcul de la mise de fonds minimum selon le type de propriété
function calcMiseFondsMin(prix, type) {
  if (type === "triplex" || type === "quatreplex") {
    return prix <= 1_500_000 ? prix * 0.10 : prix * 0.20;
  }
  // Maison / Duplex
  if (prix <= 500_000)   return prix * 0.05;
  if (prix <= 1_500_000) return 25_000 + (prix - 500_000) * 0.10;
  return prix * 0.20;
}

function calcMiseFondsPct(prix, type) {
  return prix > 0 ? (calcMiseFondsMin(prix, type) / prix) * 100 : 0;
}

function DetailHypotheque({ results, onNext }) {
  const [prixAchat, setPrixAchat] = useState("");
  const [propType, setPropType] = useState("maison"); // maison | duplex | triplex | quatreplex
  const [housing, setHousing] = useState({
    taxes:    results.taxes,
    assHabit: 80,
    hydro:    results.hydro,
    condo:    results.condo,
  });
  const [autresFrais, setAutresFrais] = useState({
    notaire:         1750,
    inspection:      800,
    taxesQC:         3000,
    taxesBienvenue:  8000,
  });

  const prix = parseNum(prixAchat);
  const totalHousing = housing.taxes + housing.assHabit + housing.hydro + housing.condo;
  const miseFondsMin = calcMiseFondsMin(prix, propType);
  const miseFondsPct = calcMiseFondsPct(prix, propType);
  const fraisDemarrage = prix * 0.015;
  const totalEpargne = miseFondsMin + fraisDemarrage;

  // Taux SCHL selon le % réel de mise de fonds
  // Triplex/Quatreplex: mêmes taux que Maison/Duplex, mais pas de SCHL sous 10% (minimum est déjà 10%)
  function schlRateFromMise(mise) {
    const pct = prix > 0 ? mise / prix : 0;
    if (pct >= 0.20) return 0;
    if (pct >= 0.15) return 0.028;
    if (pct >= 0.10) return 0.031;
    return 0.040;
  }

  const isMultiLogement = propType === "triplex" || propType === "quatreplex";

  function buildScenario(label, mise, highlight = false) {
    const solde     = prix - mise;
    const schlRate  = schlRateFromMise(mise);
    const schl      = solde * schlRate;
    const pretFinal = solde + schl;
    const pay25 = pretFinal > 0 ? (pretFinal / 1000) * paymentPer1000(RATES.marketFixe, 25) : 0;
    const pay30 = pretFinal > 0 ? (pretFinal / 1000) * paymentPer1000(RATES.marketFixe, 30) : 0;
    const pctReel = prix > 0 ? (mise / prix * 100).toFixed(1).replace(".", ",") + " %" : "";
    return { label, mise, solde, schl, schlRate, pretFinal, pay25, pay30,
      total25: pay25 + totalHousing,
      total30: pay30 + totalHousing,
      pctReel, highlight };
  }

  // Scénario 1: minimum légal selon type + prix (déjà calculé)
  // Scénarios suivants: 10%, 15%, 20% — seulement si > miseFondsMin
  const scenarios = [
    buildScenario(`Minimum légal (${miseFondsPct.toFixed(1).replace(".", ",")} %)`, miseFondsMin, true),
    ...([0.10, 0.15, 0.20].filter(pct => prix * pct > miseFondsMin).map(pct =>
      buildScenario(`${(pct * 100).toFixed(0)} %`, prix * pct)
    )),
  ];

  return (
    <div className="animate-in">
      <StepHeader
        kicker="Analyse détaillée"
        title="Hypothèque en détail"
        subtitle="Entrez le prix d'achat visé pour voir tous les scénarios."
      />

      {/* Sélecteur type de propriété */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        {[
          { key: "maison",     label: "Maison" },
          { key: "duplex",     label: "Duplex" },
          { key: "triplex",    label: "Triplex" },
          { key: "quatreplex", label: "Quadruplex" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPropType(key)}
            className={`py-2.5 rounded-xl border-2 text-sm font-semibold transition ${
              propType === key
                ? "border-blue-900 bg-white text-blue-900 shadow-sm"
                : "border-stone-200 bg-white text-slate-600 hover:border-stone-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <CurrencyInput
        label="Prix d'achat visé"
        value={prixAchat}
        onChange={setPrixAchat}
        placeholder="500 000"
      />

      {prix > 0 && (
        <>
          {/* ── OBLIGATION D'ÉPARGNE ── */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 mt-6 mb-4">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4">
              Obligation d'épargne pour l'achat
            </div>
            <div className="space-y-2 mb-4">
              <div className="flex justify-between items-center bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5">
                <span className="text-sm font-semibold text-slate-800">
                  Mise de fonds minimum ({miseFondsPct.toFixed(1).replace(".", ",")} %)
                </span>
                <span className="text-sm font-bold tabular text-orange-700">{fmtMoney(miseFondsMin)}</span>
              </div>
              <div className="flex justify-between items-center bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5">
                <span className="text-sm font-semibold text-slate-800">Épargne frais démarrage 1,5%</span>
                <span className="text-sm font-bold tabular text-orange-700">{fmtMoney(fraisDemarrage)}</span>
              </div>
              <div className="flex justify-between items-center bg-green-100 border border-green-300 rounded-lg px-4 py-3">
                <span className="text-sm font-bold text-green-900">
                  Total exigé pour l'achat ({(miseFondsPct + 1.5).toFixed(1).replace(".", ",")} %)
                </span>
                <span className="text-sm font-bold tabular text-green-800">{fmtMoney(totalEpargne)}</span>
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-orange-500 text-white text-center text-sm font-bold py-2 tracking-wide">
                Autres frais
              </div>
              <div className="divide-y divide-stone-100">
                {[
                  ["Notaire",         "notaire"],
                  ["Inspection",      "inspection"],
                  ["Taxes Québec",    "taxesQC"],
                  ["Taxes bienvenue", "taxesBienvenue"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm font-semibold text-slate-800">{label}</span>
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={autresFrais[key]}
                        onChange={(e) => setAutresFrais(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-stone-200 rounded-lg pl-6 pr-2 py-1.5 text-sm tabular text-right focus:outline-none focus:ring-2 focus:ring-blue-900"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── DÉTAIL HYPOTHÈQUE ── */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 mb-4">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Détail hypothèque
            </div>
            <div className="text-xs text-slate-400 mb-4">
              Taux de référence du marché: {(RATES.marketFixe * 100).toFixed(2)} %
            </div>

            {/* Frais mensuels éditables */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 mb-5">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
                Frais mensuels
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <HousingInput label="Taxes mun. & scol."  value={housing.taxes}    onChange={v => setHousing(h => ({ ...h, taxes: v }))} />
                <HousingInput label="Ass. habitation"     value={housing.assHabit} onChange={v => setHousing(h => ({ ...h, assHabit: v }))} />
                <HousingInput label="Hydroquébec"         value={housing.hydro}    onChange={v => setHousing(h => ({ ...h, hydro: v }))} />
                <HousingInput label="Frais condo"         value={housing.condo}    onChange={v => setHousing(h => ({ ...h, condo: v }))} />
              </div>
              <div className="flex justify-between pt-2 border-t border-stone-200">
                <span className="text-sm font-bold text-slate-800">Total frais mensuels</span>
                <span className="text-sm font-bold tabular text-slate-800">{fmtMoneyPrecise(totalHousing)}</span>
              </div>
            </div>

            {/* Scénarios par mise de fonds */}
            <div className="space-y-3">
              {/* En-tête colonnes */}
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Mise de fonds</div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-600">25 ans</div>
                <div className="text-xs font-bold uppercase tracking-wider text-blue-900">30 ans</div>
              </div>

              {scenarios.map((s) => (
                <div key={s.label} className="border border-stone-200 rounded-xl overflow-hidden">
                  {/* Header ligne */}
                  <div className={`border-b border-stone-200 px-4 py-2.5 flex justify-between items-center ${s.highlight ? "bg-blue-900" : "bg-stone-50"}`}>
                    <span className={`text-sm font-bold ${s.highlight ? "text-white" : "text-blue-900"}`}>{s.label}</span>
                    <span className={`text-sm tabular font-bold ${s.highlight ? "text-orange-300" : "text-orange-700"}`}>{fmtMoney(s.mise)}</span>
                  </div>

                  {/* Détails solde/SCHL/prêt */}
                  <div className="px-4 py-2 space-y-1 border-b border-stone-100">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Solde hypothèque</span>
                      <span className="tabular font-semibold text-slate-800">{fmtMoney(s.solde)}</span>
                    </div>
                    {s.schl > 0 && (
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Assurance SCHL ({(s.schlRate * 100).toFixed(1)} %)</span>
                        <span className="tabular font-semibold text-slate-800">{fmtMoney(s.schl)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs font-bold text-slate-800 pt-1 border-t border-stone-100">
                      <span>Prêt final</span>
                      <span className="tabular">{fmtMoney(s.pretFinal)}</span>
                    </div>
                  </div>

                  {/* Paiements 25 ans vs 30 ans */}
                  <div className="grid grid-cols-2 divide-x divide-stone-200">
                    <div className="px-3 py-3 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">25 ans — paiement / mois</div>
                      <div className="text-base font-bold tabular text-orange-700">{fmtMoney(s.pay25)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">+ {fmtMoney(totalHousing)} frais</div>
                      <div className="mt-1.5 pt-1.5 border-t border-stone-100 text-xs font-bold text-blue-900 tabular">
                        Total: {fmtMoney(s.total25)}
                      </div>
                    </div>
                    <div className="px-3 py-3 text-center bg-blue-900/5">
                      <div className="text-[11px] text-slate-500 mb-1">30 ans — paiement / mois</div>
                      <div className="text-base font-bold tabular text-orange-700">{fmtMoney(s.pay30)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">+ {fmtMoney(totalHousing)} frais</div>
                      <div className="mt-1.5 pt-1.5 border-t border-stone-100 text-xs font-bold text-blue-900 tabular">
                        Total: {fmtMoney(s.total30)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <PrimaryButton className="mt-6" onClick={onNext}>
        Continuer
      </PrimaryButton>
    </div>
  );
}

function HousingInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full border border-stone-200 rounded-lg pl-6 pr-2 py-1.5 text-sm tabular focus:outline-none focus:ring-2 focus:ring-blue-900"
        />
      </div>
    </div>
  );
}

// ============================================================
// Étape 8 — Lead capture
// ============================================================
function LeadCapture({ data, update, onSubmit, results, onShowPrivacy }) {
  const [errors, setErrors] = useState({});

  const handleSubmit = () => {
    const errs = {};
    if (!data.firstName.trim()) errs.firstName = "Requis";
    if (!data.lastName.trim()) errs.lastName = "Requis";
    if (!data.email.trim() || !/^\S+@\S+\.\S+$/.test(data.email)) errs.email = "Courriel invalide";
    if (!data.phone.trim() || data.phone.replace(/\D/g, "").length < 10) errs.phone = "Téléphone invalide";
    if (!data.consent) errs.consent = "Consentement requis";
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      // En production: POST vers backend qui envoie courriel au courtier
      console.log("Lead envoyé au courtier:", { ...data, results });
      onSubmit();
    }
  };

  return (
    <div className="animate-in">
      <StepHeader
        kicker="Dernière étape"
        title="Votre analyse personnalisée"
        subtitle="Votre courtier vous enverra les 4 scénarios détaillés, les frais à prévoir et un plan d'action dans les 24 heures."
      />

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Prénom"
            value={data.firstName}
            onChange={(v) => update({ firstName: v })}
            error={errors.firstName}
            compact
          />
          <TextInput
            label="Nom"
            value={data.lastName}
            onChange={(v) => update({ lastName: v })}
            error={errors.lastName}
            compact
          />
        </div>
        <TextInput
          label="Courriel"
          type="email"
          value={data.email}
          onChange={(v) => update({ email: v })}
          error={errors.email}
        />
        <TextInput
          label="Téléphone"
          type="tel"
          value={data.phone}
          onChange={(v) => update({ phone: v })}
          error={errors.phone}
          placeholder="514 555-1234"
        />

        <label className="flex items-start gap-3 cursor-pointer pt-2">
          <input
            type="checkbox"
            checked={data.consent}
            onChange={(e) => update({ consent: e.target.checked })}
            className="mt-1 w-4 h-4 accent-blue-900"
          />
          <span className="text-sm text-slate-600 leading-relaxed">
            J'accepte d'être contacté par <strong>Ronny Aguilera</strong>, courtier hypothécaire, concernant ma demande. Mes informations sont utilisées uniquement dans le cadre de cette demande et ne sont jamais partagées avec des tiers. <button type="button" onClick={onShowPrivacy} className="underline text-blue-900 hover:text-blue-700 transition">Politique de confidentialité</button>.
          </span>
        </label>
        {errors.consent && <div className="text-xs text-red-600 -mt-2">{errors.consent}</div>}
      </div>

      <PrimaryButton className="mt-8" onClick={handleSubmit}>
        Recevoir mon analyse
      </PrimaryButton>
    </div>
  );
}

// ============================================================
// Étape 8 — Confirmation
// ============================================================
function Merci({ data }) {
  return (
    <div className="animate-fade text-center pt-12">
      <div className="w-16 h-16 rounded-full bg-blue-900 mx-auto mb-6 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-8 h-8 text-stone-50" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>

      <div className="font-display text-4xl leading-tight mb-4 tracking-tight">
        Merci, {data.firstName || "cher client"}.
      </div>

      <p className="text-slate-600 leading-relaxed max-w-sm mx-auto mb-8">
        Votre analyse complète vous sera envoyée à <strong className="text-slate-900">{data.email}</strong> dans les prochaines heures. Un courtier pourrait vous contacter au <strong className="text-slate-900">{data.phone}</strong> sous peu.
      </p>

      <div className="bg-white border border-stone-200 rounded-xl p-5 text-left space-y-2 max-w-sm mx-auto mb-8">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Prochaines étapes</div>
        <div className="flex gap-3 items-start">
          <span className="text-blue-900 font-semibold">1.</span>
          <span className="text-sm text-slate-700">Préparez vos documents (T4, avis de cotisation, relevés bancaires)</span>
        </div>
        <div className="flex gap-3 items-start">
          <span className="text-blue-900 font-semibold">2.</span>
          <span className="text-sm text-slate-700">Consultez votre dossier Equifax si ce n'est pas déjà fait</span>
        </div>
        <div className="flex gap-3 items-start">
          <span className="text-blue-900 font-semibold">3.</span>
          <span className="text-sm text-slate-700">Rencontrez votre courtier pour une pré-approbation officielle</span>
        </div>
      </div>

      <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
        Cette estimation n'est pas une offre de financement. Seule une institution financière peut émettre une pré-approbation.
      </p>
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-xs mx-auto">
        <p className="text-xs text-amber-800 leading-relaxed">
          Les taux d'intérêt affichés sur cette plateforme sont fournis à titre indicatif seulement et sont basés sur une moyenne du marché. Le taux final peut varier selon le profil du client et les conditions des prêteurs.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// UI Primitives
// ============================================================
function StepHeader({ kicker, title, subtitle }) {
  return (
    <div className="mb-8">
      <div className="text-xs uppercase tracking-[0.2em] text-blue-900/70 mb-3 font-medium">
        {kicker}
      </div>
      <h2 className="font-display text-3xl leading-[1.1] tracking-tight text-slate-900 mb-3">
        {title}
      </h2>
      {subtitle && <p className="text-slate-600 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, className = "" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full bg-blue-900 text-stone-50 font-semibold rounded-xl py-4 text-base hover:bg-blue-950 transition active:scale-[0.98] disabled:bg-stone-300 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

function CurrencyInput({ label, value, onChange, placeholder = "0", helper, suffix, compact }) {
  return (
    <div>
      <label className={`block text-sm font-medium text-slate-900 ${compact ? "mb-1" : "mb-2"}`}>
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
          placeholder={placeholder}
          className="w-full bg-white border border-stone-200 rounded-xl pl-8 pr-24 py-3.5 text-base tabular focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-blue-900 transition"
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {helper && <div className="text-xs text-slate-500 mt-1.5">{helper}</div>}
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text", error, compact }) {
  return (
    <div>
      <label className={`block text-sm font-medium text-slate-900 ${compact ? "mb-1" : "mb-2"}`}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white border rounded-xl px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-blue-900 transition ${error ? "border-red-400" : "border-stone-200"}`}
      />
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition ${checked ? "bg-blue-900" : "bg-stone-300"}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

function ChoiceCard({ selected, onClick, title, subtitle }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-5 rounded-xl border-2 transition ${selected ? "border-blue-900 bg-white shadow-sm" : "border-stone-200 bg-white hover:border-stone-300"}`}
    >
      <div className={`font-display text-2xl mb-1 ${selected ? "text-blue-900" : "text-slate-900"}`}>{title}</div>
      <div className="text-sm text-slate-500">{subtitle}</div>
    </button>
  );
}

function ChoiceRow({ selected, onClick, title, subtitle, detail }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition flex items-center gap-4 ${selected ? "border-blue-900 bg-white" : "border-stone-200 bg-white hover:border-stone-300"}`}
    >
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? "border-blue-900" : "border-stone-300"}`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-blue-900" />}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{subtitle}</div>
      </div>
      <div className="text-xs text-slate-400 hidden sm:block">{detail}</div>
    </button>
  );
}

function ScenarioCard({ label, years, amount, rate, highlight }) {
  return (
    <div className={`rounded-xl p-4 border ${highlight ? "border-blue-900 bg-white shadow-sm" : "border-stone-200 bg-white"}`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className="text-xs text-slate-400">{years}</div>
      </div>
      <div className={`font-display text-xl tabular ${highlight ? "text-blue-900" : "text-slate-900"}`}>
        {fmtMoney(amount)}
      </div>
      <div className="text-[11px] text-slate-400 mt-1">
        Qual. {(rate * 100).toFixed(2).replace(".", ",")} %
      </div>
    </div>
  );
}

function DetailRow({ label, value, subtle }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-sm ${subtle ? "text-slate-400" : "text-slate-600"}`}>{label}</span>
      <span className={`text-sm tabular font-semibold ${subtle ? "text-slate-500" : "text-slate-900"}`}>{value}</span>
    </div>
  );
}

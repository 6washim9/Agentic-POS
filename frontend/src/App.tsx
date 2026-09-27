import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackIcon,
  BookIcon,
  BoxIcon,
  CartIcon,
  ClockIcon,
  FlameIcon,
  GridIcon,
  HomeIcon,
  MenuIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
} from "./components/Icons";
import { MicButton } from "./components/MicButton";
import {
  can,
  cellOf,
  clipOwner,
  defaultCaps,
  forceSuperAdminAdmin,
  voiceKey,
  type Cell,
  type Role,
} from "./domain/rbac";
import { canWriteCatalog, upsertSku, type SkuDraft } from "./domain/sku";
import { createUser, type UserDraft } from "./domain/user";
import { buildConfirmPrompt, parseConfirmReply } from "./domain/voiceConfirm";
import { closeShift, openShift } from "./domain/shift";
import { copy, type Lang } from "./i18n/copy";
import { AdminMatrix } from "./screens/AdminMatrix";
import { Catalog } from "./screens/Catalog";
import { Home } from "./screens/Home";
import { Landed } from "./screens/Landed";
import { Ledger } from "./screens/Ledger";
import { Receipt } from "./screens/Receipt";
import { SaleForm } from "./screens/Sale";
import { Settings } from "./screens/Settings";
import { ShiftScreen } from "./screens/Shift";
import { Spoilage } from "./screens/Spoilage";
import { Users } from "./screens/Users";
import { Warehouse } from "./screens/Warehouse";
import { Wizard } from "./screens/Wizard";
import {
  applyLocalCollection,
  applyLocalLanded,
  applyLocalReminder,
  applyLocalSale,
  applyLocalSpoilage,
  hydrateState,
  loadPersisted,
  matchVoiceToIds,
  persistState,
  recalc,
} from "./store/offline";
import { defaultState } from "./store/seed";
import { canUseSpeech, listenOnce, speak } from "./store/speech";
import { fetchBootstrap, postJson, pushQueue } from "./store/sync";
import type { AppState, Sale, Screen } from "./store/types";

const ROLE_CYCLE: Role[] = ["enterer", "owner", "super_admin"];

function roleChipLabel(role: Role, lang: Lang): string {
  if (role === "super_admin") return lang === "bn" ? "সুপার অ্যাডমিন" : "Super Admin";
  if (role === "owner") return lang === "bn" ? "মালিক" : "Owner";
  return lang === "bn" ? "এন্ট্রি" : "Enterer";
}

type SaleDraft = {
  skuId: string;
  customerId: string;
  qty: number;
  returned: number;
  onCredit: boolean;
  cashPaid: number;
};

type CollectDraft = { customerId: string; amount: number; note: string };

export default function App() {
  const [state, setState] = useState<AppState>(defaultState);
  const [screen, setScreen] = useState<Screen>("wizard");
  const [listening, setListening] = useState(false);
  const [banner, setBanner] = useState("");
  const [typed, setTyped] = useState("");
  const [hitl, setHitl] = useState<null | { kind: string; payload: SaleDraft }>(null);
  const [pendingConfirm, setPendingConfirm] = useState<null | { form: SaleDraft; prompt: string }>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [saleForm, setSaleForm] = useState<SaleDraft>({
    skuId: "fuji",
    customerId: "rahim",
    qty: 10,
    returned: 0,
    onCredit: true,
    cashPaid: 0,
  });
  const [landedForm, setLandedForm] = useState({
    skuId: "fuji",
    crates: 100,
    base: 40000,
    duty: 5000,
    freight: 3000,
    clearance: 2000,
    transport: 1000,
    challan: "CH-NEW",
  });
  const [spoilForm, setSpoilForm] = useState({ skuId: "orange", qty: 8, grade: "C", writeOff: true });
  const [collectForm, setCollectForm] = useState<CollectDraft>({ customerId: "rahim", amount: 0, note: "" });
  const [pendingCollect, setPendingCollect] = useState<null | { form: CollectDraft; prompt: string }>(null);
  const [collectHitl, setCollectHitl] = useState<null | { form: CollectDraft }>(null);
  const [navOpen, setNavOpen] = useState(false);

  const lang: Lang = state.config.language;
  const t = copy[lang];
  const role = state.session.role;

  const save = useCallback((next: AppState) => {
    setState(next);
    void persistState(next);
  }, []);

  const allowed = useCallback(
    (key: string) => can(state.permissions.caps, state.permissions.owner, role, key),
    [state.permissions.caps, state.permissions.owner, role],
  );

  const goGuarded = useCallback(
    (next: Screen) => {
      if (next === "wizard") {
        setScreen("wizard");
        return;
      }
      const key = next === "users" ? "screen.admin" : `screen.${next}`;
      if (!allowed(key)) {
        setBanner(t.forbidden);
        setScreen(allowed("screen.home") ? "home" : allowed("screen.sale") ? "sale" : "home");
        return;
      }
      setScreen(next);
    },
    [allowed, t.forbidden],
  );

  useEffect(() => {
    if (screen === "wizard") return;
    const key = screen === "users" ? "screen.admin" : `screen.${screen}`;
    if (allowed(key)) return;
    setBanner(t.forbidden);
    const fallback: Screen = allowed("screen.home") ? "home" : allowed("screen.sale") ? "sale" : screen;
    if (fallback !== screen) setScreen(fallback);
  }, [role, screen, allowed, t.forbidden]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persisted = await loadPersisted();
      const remote = await fetchBootstrap(persisted?.session.role ?? "enterer");
      if (cancelled) return;
      if (persisted) {
        let next = { ...persisted, online: navigator.onLine };
        const remotePerms = remote?.permissions as
          | { caps: AppState["permissions"]["caps"]; owner: Record<string, Cell>; occurredAt?: number; occurred_at?: number }
          | undefined;
        if (remotePerms?.caps) {
          const remoteAt = remotePerms.occurredAt ?? remotePerms.occurred_at ?? 0;
          if (remoteAt >= (persisted.permissions.occurredAt ?? 0)) {
            next = {
              ...next,
              permissions: {
                caps: remotePerms.caps,
                owner: clipOwner(remotePerms.caps.enterer, remotePerms.owner ?? {}),
                occurredAt: remoteAt,
              },
            };
          }
        }
        setState(next);
        setScreen(next.onboarded ? "home" : "wizard");
      } else if (remote?.skus) {
        const hydrated = hydrateState({ ...remote, onboarded: false });
        setState({ ...hydrated, session: { role: "enterer" } });
      }
    })();
    const onOnline = () => setState((s) => ({ ...s, online: true }));
    const onOffline = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!state.online) return;
    void pushQueue(state, role).then((queue) => {
      if (!queue) return;
      setState((s) => {
        const next = recalc({ ...s, queue });
        void persistState(next);
        return next;
      });
    });
  }, [state.online, state.queue.length, role]);

  const announce = (tts: { bn: string; en: string } | string) => {
    const text = typeof tts === "string" ? tts : lang === "bn" ? tts.bn : tts.en;
    setBanner(text);
    speak(text, lang);
  };

  const commitSale = (override = false, form = saleForm) => {
    try {
      if (!allowed("screen.sale") && !allowed("agent.sale")) {
        setBanner(t.forbidden);
        return;
      }
      const result = applyLocalSale(state, {
        skuId: form.skuId,
        customerId: form.customerId,
        cratesSold: form.qty,
        cratesReturned: form.returned,
        onCredit: form.onCredit,
        cashPaid: form.cashPaid,
        confirmOverride: override,
      });
      if (result.hitl) {
        if (cellOf(state.permissions.caps, state.permissions.owner, role, "hitl.credit_override") === "deny") {
          setBanner(t.forbidden);
          return;
        }
        setHitl({ kind: result.hitl, payload: form });
        return;
      }
      if (!result.sale) return;
      save(result.state);
      setLastSale(result.sale);
      setPendingConfirm(null);
      announce(result.tts);
      goGuarded("receipt");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : t.fallback);
    }
  };

  const commitCollection = (override = false, form = collectForm) => {
    try {
      if (!allowed("screen.ledger") && !allowed("agent.collection")) {
        setBanner(t.forbidden);
        return;
      }
      const result = applyLocalCollection(state, {
        customerId: form.customerId,
        amount: form.amount,
        note: form.note || undefined,
        confirmOverride: override,
      });
      if (result.hitl) {
        if (cellOf(state.permissions.caps, state.permissions.owner, role, "hitl.advance") === "deny") {
          setBanner(t.forbidden);
          return;
        }
        setCollectHitl({ form });
        return;
      }
      if (!result.collection) return;
      save(result.state);
      setPendingCollect(null);
      announce(result.tts);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : t.fallback);
    }
  };

  const requestCollectConfirm = (form: CollectDraft) => {
    const customer = state.customers.find((c) => c.id === form.customerId);
    if (!customer) {
      commitCollection(false, form);
      return;
    }
    const name = lang === "bn" ? customer.name_bn : customer.name;
    const prompt =
      lang === "bn"
        ? `${name}, জমা ${form.amount} টাকা — ঠিক?`
        : `${name}, deposit ${form.amount} Taka — correct?`;
    setCollectForm(form);
    setPendingCollect({ form, prompt });
    announce(prompt);
  };

  const requestConfirm = (form: SaleDraft) => {
    const sku = state.skus.find((s) => s.id === form.skuId);
    const customer = state.customers.find((c) => c.id === form.customerId);
    if (!sku || !customer) {
      commitSale(false, form);
      return;
    }
    const amount = sku.unit_price * form.qty;
    const prompt = buildConfirmPrompt({
      intent: "sale",
      customerName: lang === "bn" ? customer.name_bn : customer.name,
      skuName: lang === "bn" ? sku.name_bn : sku.name,
      qty: form.qty,
      amount,
      onCredit: form.onCredit,
      lang,
    });
    setSaleForm(form);
    setPendingConfirm({ form, prompt });
    announce(prompt);
  };

  const handleConfirmReply = (utterance: string) => {
    if (pendingCollect) {
      const reply = parseConfirmReply(utterance);
      if (reply.decision === "commit") {
        commitCollection(false, pendingCollect.form);
        return true;
      }
      setPendingCollect(null);
      setBanner(t.cancel);
      return true;
    }
    if (!pendingConfirm) return false;
    const reply = parseConfirmReply(utterance);
    if (reply.decision === "commit") {
      commitSale(false, pendingConfirm.form);
      return true;
    }
    if (reply.decision === "revise" && reply.qty !== undefined) {
      const next = { ...pendingConfirm.form, qty: reply.qty };
      requestConfirm(next);
      return true;
    }
    setPendingConfirm(null);
    setBanner(t.cancel);
    return true;
  };

  const runVoice = async (utterance: string, confidence = 0.95) => {
    if ((pendingConfirm || pendingCollect) && handleConfirmReply(utterance)) return;
    const { parsed, sku, customer } = matchVoiceToIds(state, utterance);
    setTyped(utterance);
    const key = voiceKey(parsed.intent);
    if (key && !allowed(key)) {
      setBanner(t.forbidden);
      return;
    }
    if (parsed.needsFallback || confidence < 0.8) {
      setBanner(t.fallback);
      if (allowed("screen.ledger")) setScreen("ledger");
      else if (allowed("screen.sale")) setScreen("sale");
      return;
    }
    if (parsed.intent === "sale") {
      const skuId = sku?.id ?? saleForm.skuId;
      const qty = Number(parsed.entities.qty ?? saleForm.qty);
      const onCredit = Boolean(parsed.entities.on_credit ?? saleForm.onCredit);
      const unit = state.skus.find((s) => s.id === skuId)?.unit_price ?? 0;
      const nextForm: SaleDraft = {
        ...saleForm,
        skuId,
        customerId: customer?.id ?? saleForm.customerId,
        qty,
        onCredit,
        cashPaid: onCredit ? 0 : unit * qty,
      };
      setSaleForm(nextForm);
      if (allowed("screen.sale")) setScreen("sale");
      if (sku && customer && parsed.entities.qty) requestConfirm(nextForm);
      return;
    }
    if (parsed.intent === "spoilage") {
      setSpoilForm((f) => ({
        ...f,
        skuId: sku?.id ?? f.skuId,
        qty: Number(parsed.entities.qty ?? f.qty),
        grade: String(parsed.entities.grade ?? f.grade),
      }));
      if (allowed("screen.spoilage")) setScreen("spoilage");
      return;
    }
    if (parsed.intent === "debt_reminder") {
      if (allowed("screen.ledger")) setScreen("ledger");
      return;
    }
    if (parsed.intent === "payment") {
      const amount = Number(parsed.entities.amount ?? 0);
      const form: CollectDraft = { customerId: customer?.id ?? collectForm.customerId, amount, note: "" };
      setCollectForm(form);
      if (allowed("screen.ledger")) setScreen("ledger");
      if (customer && amount > 0) requestCollectConfirm(form);
      return;
    }
    setBanner(t.fallback);
  };

  const onMic = async () => {
    if (listening) return;
    if (!canUseSpeech()) {
      setBanner(t.typeCommand);
      return;
    }
    setListening(true);
    try {
      const result = await listenOnce(lang);
      await runVoice(result.transcript, result.confidence);
    } catch {
      setBanner(t.fallback);
    } finally {
      setListening(false);
    }
  };

  const cycleRole = () => {
    const idx = ROLE_CYCLE.indexOf(role);
    const next = ROLE_CYCLE[(idx + 1) % ROLE_CYCLE.length];
    save({ ...state, session: { role: next } });
  };

  const saveCaps = async (caps = forceSuperAdminAdmin(state.permissions.caps)) => {
    const owner = clipOwner(caps.enterer, state.permissions.owner);
    const permissions = { caps, owner, occurredAt: Date.now() };
    save({ ...state, permissions });
    const res = await postJson("/api/permissions/caps", { caps }, role, "PUT");
    if (!res.ok) setBanner(t.forbidden);
  };

  const saveOwner = async (ownerMap = state.permissions.owner) => {
    const res = await postJson<
      { owner?: Record<string, Cell>; occurred_at?: number } | { detail?: { code?: string } }
    >("/api/permissions/owner", ownerMap, role, "PUT");
    if (!res.ok) {
      const detail = (res.data as { detail?: { code?: string } } | undefined)?.detail;
      setBanner(detail?.code === "CAP_EXCEEDED" ? t.capExceeded : t.forbidden);
      return;
    }
    save({
      ...state,
      permissions: {
        ...state.permissions,
        owner: clipOwner(state.permissions.caps.enterer, ownerMap),
        occurredAt: Date.now(),
      },
    });
  };

  const tabs = useMemo(
    () =>
      (
        [
          { id: "home" as Screen, label: lang === "bn" ? "হোম" : "Home", icon: <HomeIcon /> },
          { id: "catalog" as Screen, label: t.catalog, icon: <GridIcon /> },
          { id: "sale" as Screen, label: t.sale, icon: <CartIcon /> },
          { id: "ledger" as Screen, label: t.ledger, icon: <BookIcon /> },
          { id: "warehouse" as Screen, label: t.warehouse, icon: <BoxIcon /> },
        ] as const
      ).filter((tab) => allowed(`screen.${tab.id}`)),
    [lang, t.catalog, t.ledger, t.sale, t.warehouse, allowed],
  );

  const sideLinks = useMemo(
    () =>
      [
        { id: "home" as Screen, label: lang === "bn" ? "হোম" : "Home", icon: <HomeIcon />, show: allowed("screen.home") },
        { id: "sale" as Screen, label: t.pos, icon: <CartIcon />, show: allowed("screen.sale") },
        { id: "catalog" as Screen, label: t.catalog, icon: <GridIcon />, show: allowed("screen.catalog") },
        { id: "ledger" as Screen, label: t.ledger, icon: <BookIcon />, show: allowed("screen.ledger") },
        { id: "warehouse" as Screen, label: t.warehouse, icon: <BoxIcon />, show: allowed("screen.warehouse") },
        { id: "spoilage" as Screen, label: t.spoilage, icon: <FlameIcon />, show: allowed("screen.spoilage") },
        { id: "shift" as Screen, label: t.shift, icon: <ClockIcon />, show: allowed("screen.shift") },
        { id: "settings" as Screen, label: t.settings, icon: <SettingsIcon />, show: allowed("screen.settings") },
        { id: "admin" as Screen, label: t.admin, icon: <ShieldIcon />, show: allowed("screen.admin") },
        { id: "users" as Screen, label: t.users, icon: <UsersIcon />, show: allowed("screen.admin") },
      ].filter((item) => item.show),
    [allowed, lang, t.admin, t.catalog, t.ledger, t.pos, t.settings, t.shift, t.spoilage, t.users, t.warehouse],
  );

  const pendingCount = state.kpis.pending_events;
  const titles: Partial<Record<Screen, string>> = {
    home: t.dashboard,
    catalog: t.catalog,
    sale: t.pos,
    ledger: t.ledger,
    warehouse: t.warehouse,
    landed: t.landed,
    spoilage: t.spoilage,
    wizard: t.wizardTitle,
    receipt: t.print,
    shift: t.zReport,
    settings: t.settings,
    admin: t.admin,
    users: t.users,
  };
  const screenTitle = titles[screen] ?? t.appName;

  const goNav = (next: Screen) => {
    setNavOpen(false);
    goGuarded(next);
  };

  return (
    <div className={`app-shell${screen === "wizard" ? " wizard-mode" : ""}`}>
      {screen !== "wizard" && (
        <aside className={`sidebar${navOpen ? " open" : ""}`} aria-label={t.menu}>
          <div className="sidebar-brand">{state.config.shop_name}</div>
          <nav className="sidebar-nav">
            {sideLinks.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item${screen === item.id ? " active" : ""}`}
                onClick={() => goNav(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
      )}
      {navOpen && screen !== "wizard" && (
        <button type="button" className="sidebar-scrim" aria-label={t.back} onClick={() => setNavOpen(false)} />
      )}
      <header className="topbar">
        <div className="chrome-left">
          <button type="button" className="icon-btn menu-toggle" aria-label={t.menu} onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </button>
          {screen !== "home" && screen !== "wizard" && (
            <button type="button" className="icon-btn" onClick={() => goNav("home")}>
              <BackIcon /> {t.back}
            </button>
          )}
          <button
            type="button"
            className={`icon-btn${screen === "sale" ? " active" : ""}`}
            onClick={() => goNav("sale")}
          >
            {t.pos}
          </button>
          <strong className="desktop-only">{screenTitle}</strong>
        </div>
        <div className="chrome-right">
          <span className="desktop-only">{new Date().toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB")}</span>
          <button type="button" className="lang-toggle" onClick={cycleRole}>
            {roleChipLabel(role, lang)}
          </button>
          <button
            type="button"
            className="lang-toggle"
            onClick={() => save({ ...state, config: { ...state.config, language: lang === "bn" ? "en" : "bn" } })}
          >
            {lang === "bn" ? "EN" : "বাং"}
          </button>
          <span className={`net-pill ${state.online ? "online" : "offline"}`}>
            {state.online ? t.online : t.offline}
            {pendingCount > 0 ? ` · ${pendingCount}` : ""}
          </span>
        </div>
      </header>
      {banner && (
        <div className="tts-banner" role="status" aria-live="polite">
          {banner}
        </div>
      )}
      <main className="main">
        {screen === "wizard" && (
          <Wizard
            lang={lang}
            config={state.config}
            onChange={(partial) => save({ ...state, config: { ...state.config, ...partial } })}
            onDone={() => {
              save({ ...state, onboarded: true });
              goGuarded("home");
            }}
          />
        )}
        {screen === "home" && (
          <Home
            lang={lang}
            kpis={state.kpis}
            sales={state.sales}
            collections={state.collections}
            shopName={state.config.shop_name}
            roleLabel={roleChipLabel(role, lang)}
            go={goGuarded}
            canGo={(s) => allowed(`screen.${s}`)}
            showSettings={allowed("screen.settings")}
            showAdmin={allowed("screen.admin")}
          />
        )}
        {screen === "catalog" && (
          <Catalog
            lang={lang}
            skus={state.skus}
            canWrite={canWriteCatalog(role)}
            onPick={(sku) => {
              setSaleForm((f) => ({ ...f, skuId: sku.id }));
              goGuarded("sale");
            }}
            onSave={(draft: SkuDraft) => {
              if (!canWriteCatalog(role)) return;
              const sku = upsertSku(state.skus, draft, new Date().toISOString());
              const skus = state.skus.some((row) => row.id === sku.id)
                ? state.skus.map((row) => (row.id === sku.id ? sku : row))
                : [...state.skus, sku];
              const lots = draft.id
                ? state.lots
                : [
                    ...state.lots,
                    {
                      sku_id: sku.id,
                      challan: `CH-NEW-${sku.id}`,
                      remaining: sku.stock,
                      unit_cost: 0,
                      received_at: Date.now(),
                    },
                  ];
              save(recalc({ ...state, skus, lots }));
            }}
          />
        )}
        {screen === "sale" && (
          <SaleForm
            lang={lang}
            skus={state.skus}
            customers={state.customers}
            manageCrates={state.config.manage_crates}
            extendCredit={state.config.extend_credit}
            skuId={saleForm.skuId}
            customerId={saleForm.customerId}
            qty={saleForm.qty}
            returned={saleForm.returned}
            onCredit={saleForm.onCredit}
            cashPaid={saleForm.cashPaid}
            onSku={(id) => setSaleForm((f) => ({ ...f, skuId: id }))}
            onCustomer={(id) => setSaleForm((f) => ({ ...f, customerId: id }))}
            onQty={(n) => setSaleForm((f) => ({ ...f, qty: n }))}
            onReturned={(n) => setSaleForm((f) => ({ ...f, returned: n }))}
            onCreditChange={(v) => {
              const sku = state.skus.find((s) => s.id === saleForm.skuId);
              const total = (sku?.unit_price ?? 0) * saleForm.qty;
              setSaleForm((f) => ({ ...f, onCredit: v, cashPaid: v ? 0 : total }));
            }}
            onCashPaid={(n) => setSaleForm((f) => ({ ...f, cashPaid: n, onCredit: n < (state.skus.find((s) => s.id === f.skuId)?.unit_price ?? 0) * f.qty }))}
            onSubmit={() => requestConfirm(saleForm)}
          />
        )}
        {screen === "ledger" && (
          <Ledger
            lang={lang}
            customers={state.customers}
            sales={state.sales}
            collections={state.collections}
            onRemind={(id, channel) => {
              const next = applyLocalReminder(state, id, channel);
              save(next);
              const note = next.reminders[next.reminders.length - 1];
              announce({ bn: note.audio_bn, en: note.audio_en });
            }}
            onCollect={(id, amount, note) => requestCollectConfirm({ customerId: id, amount, note })}
          />
        )}
        {screen === "warehouse" && <Warehouse lang={lang} skus={state.skus} go={goGuarded} />}
        {screen === "landed" && (
          <Landed
            lang={lang}
            skus={state.skus}
            skuId={landedForm.skuId}
            crates={landedForm.crates}
            base={landedForm.base}
            duty={landedForm.duty}
            freight={landedForm.freight}
            clearance={landedForm.clearance}
            transport={landedForm.transport}
            challan={landedForm.challan}
            onSku={(id) => setLandedForm((f) => ({ ...f, skuId: id }))}
            onNum={(key, n) => setLandedForm((f) => ({ ...f, [key]: n }))}
            onChallan={(value) => setLandedForm((f) => ({ ...f, challan: value }))}
            onSubmit={() => {
              const next = applyLocalLanded(state, {
                skuId: landedForm.skuId,
                crates: landedForm.crates,
                baseProcurement: landedForm.base,
                customsDuty: landedForm.duty,
                freight: landedForm.freight,
                portClearance: landedForm.clearance,
                transport: landedForm.transport,
                challan: landedForm.challan,
              });
              save(next);
              setBanner(t.saved);
              goGuarded("warehouse");
            }}
          />
        )}
        {screen === "spoilage" && (
          <Spoilage
            lang={lang}
            skus={state.skus}
            skuId={spoilForm.skuId}
            qty={spoilForm.qty}
            grade={spoilForm.grade}
            writeOff={spoilForm.writeOff}
            onSku={(id) => setSpoilForm((f) => ({ ...f, skuId: id }))}
            onQty={(n) => setSpoilForm((f) => ({ ...f, qty: n }))}
            onGrade={(g) => setSpoilForm((f) => ({ ...f, grade: g }))}
            onWriteOff={(v) => setSpoilForm((f) => ({ ...f, writeOff: v }))}
            onSubmit={() => {
              if (spoilForm.writeOff && cellOf(state.permissions.caps, state.permissions.owner, role, "hitl.write_off") === "deny") {
                setBanner(t.forbidden);
                return;
              }
              const result = applyLocalSpoilage(state, {
                skuId: spoilForm.skuId,
                qty: spoilForm.qty,
                toGrade: spoilForm.grade,
                writeOff: spoilForm.writeOff,
              });
              save(result.state);
              announce(result.tts);
            }}
          />
        )}
        {screen === "receipt" && (
          <Receipt lang={lang} sale={lastSale} customers={state.customers} onClose={() => goGuarded("home")} />
        )}
        {screen === "shift" && (
          <ShiftScreen
            lang={lang}
            shift={state.shift}
            onOpen={() => {
              const opened = openShift(state.shift.cashier || "Yard", state.shift.floatAmount || 5000, Date.now());
              save({
                ...state,
                shift: {
                  cashier: opened.cashier,
                  floatAmount: opened.floatAmount,
                  status: opened.status,
                  cashCollected: opened.cashCollected,
                  creditIssued: opened.creditIssued,
                  zTotal: opened.zTotal,
                  expectedDrawer: opened.expectedDrawer,
                  collectionCash: opened.collectionCash,
                },
              });
            }}
            onClose={() => {
              if (!allowed("hitl.shift_close")) {
                setBanner(t.forbidden);
                return;
              }
              const closed = closeShift(
                {
                  cashier: state.shift.cashier,
                  floatAmount: state.shift.floatAmount,
                  openedAt: Date.now(),
                  status: state.shift.status,
                  cashCollected: 0,
                  creditIssued: 0,
                  zTotal: 0,
                  expectedDrawer: state.shift.floatAmount,
                  collectionCash: 0,
                  closedAt: null,
                },
                state.sales.map((sale) => ({
                  amount: sale.amount,
                  cashPaid: sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount),
                })),
                Date.now(),
                state.collections.map((collection) => collection.amount),
              );
              save({
                ...state,
                shift: {
                  cashier: closed.cashier,
                  floatAmount: closed.floatAmount,
                  status: closed.status,
                  cashCollected: closed.cashCollected,
                  creditIssued: closed.creditIssued,
                  zTotal: closed.zTotal,
                  expectedDrawer: closed.expectedDrawer,
                  collectionCash: closed.collectionCash,
                },
              });
            }}
          />
        )}
        {screen === "settings" && (
          <Settings
            lang={lang}
            capsEnterer={state.permissions.caps.enterer}
            owner={state.permissions.owner}
            onChange={(owner) => save({ ...state, permissions: { ...state.permissions, owner } })}
            onSave={() => void saveOwner()}
            onCapExceeded={() => setBanner(t.capExceeded)}
          />
        )}
        {screen === "admin" && (
          <AdminMatrix
            lang={lang}
            shopName={state.config.shop_name}
            caps={state.permissions.caps}
            onChange={(caps) => save({ ...state, permissions: { ...state.permissions, caps } })}
            onSave={() => void saveCaps()}
            onReset={() => {
              const caps = defaultCaps();
              save({
                ...state,
                permissions: {
                  caps,
                  owner: clipOwner(caps.enterer, state.permissions.owner),
                  occurredAt: Date.now(),
                },
              });
            }}
          />
        )}
        {screen === "users" && (
          <Users
            lang={lang}
            users={state.users}
            onCreate={(draft: UserDraft) => {
              const user = createUser(state.users, draft, new Date().toISOString());
              save({ ...state, users: [...state.users, user] });
            }}
          />
        )}
        <div className="field voice-field">
          <label htmlFor="cmd">{t.typeCommand}</label>
          <input
            id="cmd"
            value={typed}
            placeholder={t.examples}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed.trim()) void runVoice(typed.trim());
            }}
          />
        </div>
      </main>
      <MicButton listening={listening} label={listening ? t.listening : t.speak} onClick={() => void onMic()} />
      <nav className="tabbar" aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab${screen === tab.id ? " active" : ""}`}
            onClick={() => goGuarded(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
      {pendingConfirm && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="sheet">
            <h2 id="confirm-title">{t.confirmSale}</h2>
            <p>{pendingConfirm.prompt}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => commitSale(false, pendingConfirm.form)}>
                {t.confirm}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPendingConfirm(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
      {hitl && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="hitl-title">
          <div className="sheet">
            <h2 id="hitl-title">{t.hitlTitle}</h2>
            <p>{t.hitlCredit}</p>
            <div className="row">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const form = hitl.payload;
                  setHitl(null);
                  commitSale(true, form);
                }}
              >
                {t.confirm}
              </button>
              <button type="button" className="btn ghost" onClick={() => setHitl(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingCollect && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="collect-confirm-title">
          <div className="sheet">
            <h2 id="collect-confirm-title">{t.collect}</h2>
            <p>{pendingCollect.prompt}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => commitCollection(false, pendingCollect.form)}>
                {t.confirm}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPendingCollect(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
      {collectHitl && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="collect-hitl-title">
          <div className="sheet">
            <h2 id="collect-hitl-title">{t.hitlTitle}</h2>
            <p>{t.hitlAdvance}</p>
            <div className="row">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const form = collectHitl.form;
                  setCollectHitl(null);
                  commitCollection(true, form);
                }}
              >
                {t.confirm}
              </button>
              <button type="button" className="btn ghost" onClick={() => setCollectHitl(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearRecentAgentEvents,
  exchangeDiscordAuth,
  getDiscordAuthStart,
  getRecentAgentEvents,
  getSession,
  applyUnknownCorrections,
  getUnknownCorrections,
  lookupPlayer,
  pushLookup,
  runDevDispatchTest,
  type LookupResponse,
  type RecentAgentEvent,
  type UnknownCorrectionItem
} from "./api";

declare global {
  interface Window {
    SnareHoundAHK?: {
      sendShowLocation?: () => void;
      playAlert?: () => void;
      // Add other methods if needed
    };
  }
}

const SESSION_STORAGE_KEY = "snarehound.sessionToken";
const EXEC_OPEN_DURATION_MS = 3900338;
const EXEC_CLOSE_DURATION_MS = 7200623;
const EXEC_CYCLE_DURATION_MS = EXEC_OPEN_DURATION_MS + EXEC_CLOSE_DURATION_MS;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function formatDate(input: string): string {
  if (!input) {
    return "N/A";
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function extractTargets(events: RecentAgentEvent[]): string[] {
  const targets: string[] = [];

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index].event;
    const type = asString(event.type);
    const shipName = asString(event.shipName);

    if (type !== "ship.detected" || !shipName || shipName === "UNKNOWN") {
      continue;
    }

    targets.push(shipName);
    if (targets.length >= 5) {
      break;
    }
  }

  return targets;
}

function formatCountdown(msRemaining: number): string {
  const safe = Math.max(0, msRemaining);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getExecCircleStates(timeInCycleMs: number): Array<"green" | "red" | "off"> {
  if (timeInCycleMs < 12 * 60 * 1000) {
    return ["green", "green", "green", "green", "green"];
  }
  if (timeInCycleMs < 24 * 60 * 1000) {
    return ["green", "green", "green", "green", "off"];
  }
  if (timeInCycleMs < 36 * 60 * 1000) {
    return ["green", "green", "green", "off", "off"];
  }
  if (timeInCycleMs < 48 * 60 * 1000) {
    return ["green", "green", "off", "off", "off"];
  }
  if (timeInCycleMs < 60 * 60 * 1000) {
    return ["green", "off", "off", "off", "off"];
  }
  if (timeInCycleMs < 65 * 60 * 1000) {
    return ["off", "off", "off", "off", "off"];
  }
  if (timeInCycleMs < 89 * 60 * 1000) {
    return ["red", "red", "red", "red", "red"];
  }
  if (timeInCycleMs < 113 * 60 * 1000) {
    return ["green", "red", "red", "red", "red"];
  }
  if (timeInCycleMs < 137 * 60 * 1000) {
    return ["green", "green", "red", "red", "red"];
  }
  if (timeInCycleMs < 161 * 60 * 1000) {
    return ["green", "green", "green", "red", "red"];
  }

  return ["green", "green", "green", "green", "red"];
}

function AuthCallbackPage() {
  const [status, setStatus] = useState("Processing Discord callback...");

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        setStatus("Missing OAuth code/state in callback URL.");
        return;
      }

      try {
        const response = await exchangeDiscordAuth(code, state);
        localStorage.setItem(SESSION_STORAGE_KEY, response.token);

        if (window.opener) {
          window.opener.postMessage(
            {
              type: "snarehound-auth-success",
              token: response.token,
              user: response.user,
              entitled: response.entitled
            },
            window.location.origin
          );
          window.close();
          return;
        }

        setStatus("Authentication complete. Return to the app tab.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "OAuth exchange failed.");
      }
    };

    void run();
  }, []);

  return (
    <div className="app-shell">
      <section className="card">
        <h3>Discord Auth Callback</h3>
        <pre>{status}</pre>
      </section>
    </div>
  );
}

export function App() {
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(SESSION_STORAGE_KEY) ?? "");
  const [playerHandle, setPlayerHandle] = useState("");
  const [lookupResponse, setLookupResponse] = useState<LookupResponse | null>(null);
  const [detailMode, setDetailMode] = useState<0 | 2>(2);
  const [isPaused, setIsPaused] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [unknownCorrections, setUnknownCorrections] = useState<UnknownCorrectionItem[]>([]);
  const [unknownLimit, setUnknownLimit] = useState(25);
  const [selectedSignatures, setSelectedSignatures] = useState<Record<string, boolean>>({});
  const [shipNamesBySignature, setShipNamesBySignature] = useState<Record<string, string>>({});
  const [sessionInfo, setSessionInfo] = useState<string>("No session checked yet.");
  const [status, setStatus] = useState<string>("Ready.");
  const [toastMessage, setToastMessage] = useState<string>("");
  const toastTimerRef = useRef<number | null>(null);

  const lookupView = useMemo(() => {
    if (!lookupResponse) {
      return null;
    }

    const summary = asObject(lookupResponse.summary);
    const rootProfile = asObject(lookupResponse.profile);
    const profile = asObject(rootProfile?.profile) ?? {};
    const org = asObject(rootProfile?.organization);
    const affiliationsRaw = Array.isArray(rootProfile?.affiliation) ? rootProfile.affiliation : [];

    const handle = asString(summary?.handle) || asString(profile.handle) || playerHandle;
    const display = asString(summary?.display) || asString(profile.display) || "N/A";
    const sourceLabel = asString(summary?.sourceLabel) || asString(lookupResponse.source) || "N/A";
    const enlisted = formatDate(asString(summary?.enlisted) || asString(profile.enlisted));
    const location = asString(summary?.location) || [asString(profile.country), asString(profile.region)].filter(Boolean).join(", ") || "N/A";

    const fluency = profile.fluency;
    const languages = Array.isArray(fluency)
      ? fluency.map((item) => asString(item)).filter(Boolean).join(", ")
      : asString(fluency);

    const profilePage = asObject(profile.page);
    const profileUrl = asString(summary?.profileUrl) || asString(profilePage?.url);
    const avatarUrl = asString(summary?.avatarUrl) || asString(profile.image);
    const badge = asString(summary?.badge) || asString(profile.badge) || "N/A";
    const badgeImage = asString(summary?.badge_image) || asString(profile.badge_image) || "";
    const orgName = asString(summary?.organization) || asString(org?.name) || "None";
    const orgSid = asString(summary?.organizationSid) || asString(org?.sid) || "N/A";
    const orgRank = asString(summary?.organizationRank) || asString(org?.rank) || "N/A";
    // Prefer org.members field for member count, fallback to other fields if not present
    let orgMembers = "N/A";
    if (org) {
      if (typeof org.members === "number" && Number.isFinite(org.members)) {
        orgMembers = String(org.members);
      } else if (typeof org.members === "string" && /^\d+$/.test(org.members)) {
        orgMembers = org.members;
      } else if (typeof org.member_count === "number" && Number.isFinite(org.member_count)) {
        orgMembers = String(org.member_count);
      } else if (typeof org.member_count === "string" && /^\d+$/.test(org.member_count)) {
        orgMembers = org.member_count;
      } else if (typeof org.total_members === "number" && Number.isFinite(org.total_members)) {
        orgMembers = String(org.total_members);
      } else if (typeof org.total_members === "string" && /^\d+$/.test(org.total_members)) {
        orgMembers = org.total_members;
      } else if (typeof org.population === "number" && Number.isFinite(org.population)) {
        orgMembers = String(org.population);
      } else if (typeof org.population === "string" && /^\d+$/.test(org.population)) {
        orgMembers = org.population;
      }
    }

    const affiliations = affiliationsRaw
      .map((entry) => {
        const aff = asObject(entry);
        if (!aff) {
          return "";
        }

        const name = asString(aff.name);
        const sid = asString(aff.sid);
        if (!name) {
          return "";
        }

        return sid ? `${name} [${sid}]` : name;
      })
      .filter(Boolean);

    return {
      sourceLabel,
      handle,
      display,
      enlisted,
      location,
      languages: languages || "N/A",
      badge,
      badgeImage,
      profileUrl,
      avatarUrl,
      orgName,
      orgSid,
      orgRank,
      orgMembers,
      affiliations,
      bio: asString(profile.bio) || "",
      ueeRecord: asString(profile.id) || "N/A"
    };
  }, [lookupResponse, playerHandle]);

  useEffect(() => {
    // Listen for Discord auth success
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "snarehound-auth-success") return;
      const token = typeof event.data.token === "string" ? event.data.token : "";
      if (!token) return;
      setSessionToken(token);
      localStorage.setItem(SESSION_STORAGE_KEY, token);
      setSessionInfo(JSON.stringify({ user: event.data.user, entitled: event.data.entitled }, null, 2));
      setStatus("Discord auth completed and session token stored.");
    };
    window.addEventListener("message", handler);
    // On mount, check session validity if token exists
    const token = localStorage.getItem(SESSION_STORAGE_KEY);
    if (token) {
      getSession(token).then(response => {
        setSessionToken(token);
        setSessionInfo(JSON.stringify(response, null, 2));
        setStatus("Session is valid.");
      }).catch(() => {
        setSessionInfo("Session check failed.");
        setStatus("Session invalid or expired. Please log in again.");
        setSessionToken("");
        localStorage.removeItem(SESSION_STORAGE_KEY);
      });
    }
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
  }, [sessionToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  if (window.location.pathname === "/auth/callback") {
    return <AuthCallbackPage />;
  }

  async function startDiscordAuth() {
    try {
      const response = await getDiscordAuthStart();
      window.open(response.authorizeUrl, "snarehound-discord-auth", "popup,width=540,height=760");
      setStatus("Opened Discord login popup. Session token will auto-fill after callback.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start Discord auth.");
    }
  }

  async function checkSession() {
    try {
      const response = await getSession(sessionToken.trim());
      setSessionInfo(JSON.stringify(response, null, 2));
      setStatus("Session is valid.");
    } catch (error) {
      setSessionInfo("Session check failed.");
      setStatus(error instanceof Error ? error.message : "Failed session check.");
    }
  }

  async function runLookup() {
    try {
      const handle = playerHandle.trim();
      if (!handle) {
        setStatus("Enter a player handle first.");
        return;
      }

      // 1. Lookup player info
      const response = await lookupPlayer(handle);
      setLookupResponse(response);
      setStatus("Lookup completed.");

      // 2. Push to Discord if session token is present
      if (sessionToken) {
        try {
          const pushResponse = await pushLookup(sessionToken.trim(), handle, response.profile);
          setStatus(`Lookup completed and pushed to Discord (accepted=${pushResponse.accepted}, status=${pushResponse.status})`);
        } catch (pushError) {
          setStatus("Lookup succeeded, but push to Discord failed.");
        }
      } else {
        setStatus("Lookup completed, but you are not logged in (no Discord push)." );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Lookup failed.");
    }
  }

  async function sendProtectedPush() {
    if (!lookupResponse) {
      setStatus("Run lookup first.");
      return;
    }

    try {
      const response = await pushLookup(sessionToken.trim(), playerHandle.trim(), lookupResponse.profile);
      setStatus(`Protected push complete: accepted=${response.accepted}, status=${response.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Protected push failed.");
    }
  }

  async function sendDevDispatchTest() {
    const payload = lookupResponse?.profile ?? {
      source: "frontend-dev-test",
      time: new Date().toISOString()
    };

    try {
      const response = await runDevDispatchTest(playerHandle.trim(), payload);
      setStatus(`Dev dispatch test complete: accepted=${response.accepted}, status=${response.status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Dev dispatch test failed.");
    }
  }

  async function loadUnknownCorrectionLines() {
    try {
      const response = await getUnknownCorrections(unknownLimit);
      setUnknownCorrections(response.corrections);
      const nextSelected: Record<string, boolean> = {};
      const nextShipNames: Record<string, string> = {};
      for (const item of response.corrections) {
        nextSelected[item.normalizedSignature] = false;
        nextShipNames[item.normalizedSignature] = "";
      }
      setSelectedSignatures(nextSelected);
      setShipNamesBySignature(nextShipNames);
      setStatus(`Loaded ${response.corrections.length} unknown signature correction lines.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load unknown signatures.");
    }
  }

  async function loadRecentHistory(limit = 25) {
    try {
      const response = await getRecentAgentEvents(limit);
      const nextTargets = extractTargets(response.events);
      setTargets(nextTargets);
      setStatus(`Loaded ${response.events.length} recent event(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load recent event history.");
    }
  }

  async function purgeRecentHistory() {
    if (!sessionToken.trim()) {
      setStatus("Session token is required to purge recent event data.");
      return;
    }

    try {
      const response = await clearRecentAgentEvents(sessionToken.trim());
      setTargets([]);
      setStatus(`Purged recent memory events: cleared=${response.cleared}.`);
      showToast("Recent event cache cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to purge recent events.");
    }
  }

  function openProfileLocation() {
    // New functionality: Activate Star Citizen window and send /showlocation command
    setStatus("Activating Star Citizen and sending /showlocation...");
    // This requires an external script or AHK integration
    // Example: Use window.SnareHoundAHK if available
    if (window.SnareHoundAHK && typeof window.SnareHoundAHK.sendShowLocation === "function") {
      window.SnareHoundAHK.sendShowLocation();
      setStatus("/showlocation command sent to Star Citizen.");
    } else {
      setStatus("AHK integration not available. Please ensure SnareHound AHK is running.");
    }
    // Do NOT erase clipboard after command
  }

  function nukeGlobal() {
    setLookupResponse(null);
    setTargets([]);
    setUnknownCorrections([]);
    setSelectedSignatures({});
    setShipNamesBySignature({});
    setStatus("Global in-app state cleared.");
    showToast("In-app state reset.");
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, 2500);
  }

  function toggleSignatureSelection(signature: string) {
    setSelectedSignatures((current) => ({
      ...current,
      [signature]: !current[signature]
    }));
  }

  function updateShipName(signature: string, shipName: string) {
    setShipNamesBySignature((current) => ({
      ...current,
      [signature]: shipName
    }));
  }

  function selectAllUnknowns(selected: boolean) {
    const next: Record<string, boolean> = {};
    for (const item of unknownCorrections) {
      next[item.normalizedSignature] = selected;
    }
    setSelectedSignatures(next);
  }

  async function applySelectedCorrections() {
    const entries = unknownCorrections
      .filter((item) => selectedSignatures[item.normalizedSignature])
      .map((item) => ({
        normalizedSignature: item.normalizedSignature,
        shipName: (shipNamesBySignature[item.normalizedSignature] ?? "").trim()
      }))
      .filter((item) => item.shipName.length > 0);

    if (!sessionToken.trim()) {
      setStatus("Session token is required to apply corrections.");
      return;
    }

    if (entries.length === 0) {
      setStatus("Select at least one unknown signature and enter ship name(s) to apply.");
      return;
    }

    try {
      const result = await applyUnknownCorrections(sessionToken.trim(), entries);
      setStatus(`Applied corrections: updated=${result.updated}, total=${result.total}`);
      showToast(`Saved ${result.updated} correction(s).`);
      await loadUnknownCorrectionLines();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to apply selected corrections.");
    }
  }

  async function copyTextToClipboard(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage);
      showToast("Copied to clipboard.");
    } catch {
      setStatus("Clipboard write failed (browser permissions). Copy manually from text area.");
    }
  }

  const allCorrectionLines = unknownCorrections.map((item) => item.correctionLine).join("\n");
  const cyclePosition = nowTick % EXEC_CYCLE_DURATION_MS;
  const execOpen = cyclePosition < EXEC_OPEN_DURATION_MS;
  const msToReset = execOpen ? (EXEC_OPEN_DURATION_MS - cyclePosition) : (EXEC_CYCLE_DURATION_MS - cyclePosition);
  const execCircleStates = getExecCircleStates(cyclePosition);
  const logoSrc = `${import.meta.env.BASE_URL}snarebears.png`;

  return (
    <div className="hud-shell">
      <header className="hud-top">
        <span>SNARE HOUND // TACTICAL_PIRACY_HUD</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sessionToken && sessionInfo && (() => {
            try {
              const info = JSON.parse(sessionInfo);
              if (info.user && info.user.username) {
                // Discord profile image URL: https://cdn.discordapp.com/avatars/{user.id}/{user.avatar}.png
                let avatarUrl = "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/discord.svg";
                if (info.user.avatar && info.user.id) {
                  avatarUrl = `https://cdn.discordapp.com/avatars/${info.user.id}/${info.user.avatar}.png`;
                }
                return <>
                  <img src={avatarUrl} alt="Discord" style={{ width: 24, height: 24, borderRadius: '50%', verticalAlign: 'middle', marginRight: 6, background: '#23272a' }} />
                  <span style={{ fontWeight: 600 }}>{info.user.username}</span>
                </>;
              }
            } catch {}
          })()}
          {(!sessionToken || !sessionInfo || (() => { try { const info = JSON.parse(sessionInfo); return !(info.user && info.user.username); } catch { return true; } })()) && (
            <a style={{ color: '#ffb347', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 6 }} onClick={startDiscordAuth}>
              <img src="https://cdn.discordapp.com/icons/947078888232632410/a_2b7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e.png" alt="Discord" style={{ width: 20, height: 20, verticalAlign: 'middle', marginRight: 4 }} />
              LOGIN TO DISCORD
            </a>
          )}
        </span>
      </header>

      <div className="hud-grid">
        <section className="hud-left card">
          <div className="logo-card">
            <img className="logo-image" src={logoSrc} alt="SnareBears" />
          </div>

          <div className="status-line">[ STATUS // {isPaused ? "PAUSED" : "ACTIVE"} ]</div>

          <div className="targets-list">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="target-row" key={index}>T{index + 1}: {targets[index] ?? "NONE"}</div>
            ))}
          </div>

          <div className={`exec-line ${execOpen ? "open" : "closed"}`}>[ EXEC_HANGAR: {execOpen ? "OPEN" : "CLOSED"} ]</div>
          <div className="reset-line">[ {execOpen ? "RESETS IN" : "OPENS IN"}: {formatCountdown(msToReset)} ]</div>
          <div className="exec-circles">
            {execCircleStates.map((state, index) => (
              <span className={`exec-circle ${state}`} key={index}>●</span>
            ))}
          </div>

          <div className="ops-grid">
            <button onClick={sendProtectedPush}>› SEND_ALERT ‹</button>
            <button onClick={openProfileLocation}>› /SHOWLOCATION ‹</button>
            <button onClick={() => setShowCorrections((value) => !value)}>› SHIP_CORRECTION ‹</button>
            <button onClick={() => setDetailMode(2)}>› R_DISPLAYINFO 2 ‹</button>
            <button onClick={() => setDetailMode(0)}>› R_DISPLAYINFO 0 ‹</button>
            <button onClick={() => setIsPaused((value) => !value)}>› {isPaused ? "RESUME_OPS" : "PAUSE_OPS"} ‹</button>
            <button onClick={() => {
              sendDevDispatchTest();
              // Call local AHK HTTP server to play alert sound
              fetch("http://localhost:29345/play-alert").catch(() => {});
            }}>› TEST_ALARM ‹</button>
            <button onClick={() => loadRecentHistory()}>› VIEW_HISTORY ‹</button>
            <button onClick={() => purgeRecentHistory()}>› PURGE_DATA ‹</button>
            <button onClick={nukeGlobal}>NUKE_GLOBAL</button>
          </div>

          <div className="intel-input">
            <div className="status-line">[ PLAYER_INTELLIGENCE ]</div>
            <div style={{height: '18px'}}></div>
            <form
              className="lookup-row"
              onSubmit={(event) => {
                event.preventDefault();
                void runLookup();
              }}
            >
              <input
                value={playerHandle}
                onChange={(event) => setPlayerHandle(event.target.value)}
                placeholder="Handle"
              />
              <button type="submit">› DOX ‹</button>
            </form>
          </div>

          {/* Auth box removed as login is now handled in header */}

          {showCorrections ? (
            <div className="corrections-box">
              <div className="status-line">[ SHIP_CORRECTION ]</div>
              <div className="row-inline">
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={unknownLimit}
                  onChange={(event) => setUnknownLimit(Math.max(1, Math.min(200, Number(event.target.value) || 25)))}
                />
                <button onClick={loadUnknownCorrectionLines}>Load</button>
              </div>
              <button
                onClick={() => copyTextToClipboard(`[Corrections]\n${allCorrectionLines}`, "Copied all correction lines to clipboard.")}
                disabled={unknownCorrections.length === 0}
              >
                Copy All
              </button>
              <button onClick={applySelectedCorrections} disabled={unknownCorrections.length === 0}>Apply Selected</button>
              {unknownCorrections.map((item) => (
                <div className="unknown-row" key={item.normalizedSignature}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedSignatures[item.normalizedSignature])}
                      onChange={() => toggleSignatureSelection(item.normalizedSignature)}
                    />
                    Select
                  </label>
                  <input
                    placeholder="Ship name"
                    value={shipNamesBySignature[item.normalizedSignature] ?? ""}
                    onChange={(event) => updateShipName(item.normalizedSignature, event.target.value)}
                  />
                  <pre>{item.correctionLine}</pre>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="hud-right card">
          <div className="panel-head">
            <div className="panel-title">PLAYER INTELLIGENCE</div>
            <div className="panel-source">SOURCE: {lookupView?.sourceLabel ?? "N/A"}</div>
          </div>

          {lookupView ? (
            <>
              <div className="identity-row">
                {lookupView.avatarUrl ? <img className="avatar" src={lookupView.avatarUrl} alt="avatar" /> : <div className="avatar placeholder">?</div>}
                <div>
                  <div className="identity-handle">{lookupView.handle}</div>
                  <div className="identity-display">{lookupView.display}</div>
                  <div className="identity-badge">
                    {lookupView.badgeImage ? <img src={lookupView.badgeImage} alt="badge" style={{height:24,verticalAlign:'middle',marginRight:6}} /> : null}
                    {lookupView.badge}
                  </div>
                </div>
              </div>

              <div className="intel-grid">
                <div className="intel-block">
                  <div className="intel-title" style={{textDecoration:'underline'}}>== ORG SUMMARY ==</div>
                  <div className="intel-row"><span className="intel-key">Org:</span><span className="intel-val">{lookupView.orgName}</span></div>
                  <div className="intel-row"><span className="intel-key">Rank:</span><span className="intel-val">{lookupView.orgRank}</span></div>
                  <div className="intel-row"><span className="intel-key">Org Tag:</span><span className="intel-val">{lookupView.orgSid}</span></div>
                  <div className="intel-row"><span className="intel-key">Members:</span><span className="intel-val">{lookupView.orgMembers}</span></div>
                </div>

                <div className="intel-block">
                  <div className="intel-title" style={{textDecoration:'underline'}}>== PERSONAL INFO ==</div>
                  <div className="intel-row"><span className="intel-key">Enlisted:</span><span className="intel-val">{lookupView.enlisted}</span></div>
                  <div className="intel-row"><span className="intel-key">Location:</span><span className="intel-val">{lookupView.location}</span></div>
                  <div className="intel-row"><span className="intel-key">Languages:</span><span className="intel-val">{lookupView.languages}</span></div>
                  <div className="intel-row"><span className="intel-key">Dossier:</span><span className="intel-val">{lookupView.profileUrl ? <a className="intel-link" href={lookupView.profileUrl} target="_blank" rel="noreferrer">View RSI Profile</a> : "N/A"}</span></div>
                  <div className="intel-row"><span className="intel-key">UEE Record:</span><span className="intel-val">{lookupView.ueeRecord}</span></div>
                </div>
              </div>

              {detailMode === 2 ? (
                <>
                  <div className="intel-title" style={{textDecoration:'underline'}}>== AFFILIATIONS ==</div>
                  <div className="intel-list">{lookupView.affiliations.length > 0 ? lookupView.affiliations.join(" · ") : "None"}</div>

                  <div className="intel-title" style={{textDecoration:'underline'}}>== BIO ==</div>
                  <div className="intel-bio">{lookupView.bio || "No bio available."}</div>
                </>
              ) : null}
            </>
          ) : (
            <div className="intel-bio">Run DOX to load player intelligence.</div>
          )}
        </section>
      </div>

      <section className="card status-card">
        <h3>Status</h3>
        <pre>{status}</pre>
      </section>

      {toastMessage ? <div className="toast-success">{toastMessage}</div> : null}
    </div>
  );
}

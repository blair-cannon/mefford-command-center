"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MOBILE_PRIMARY_NAVIGATION,
  MOBILE_PUSH_CATEGORIES,
  MOBILE_SCAN_TYPES,
  isSensitiveActionLabel,
  offlineSessionExpired,
  quickActionsForActor,
  type MobileQuickAction,
} from "../lib/mobile-core.js";
import {
  clearOfflineMobileData,
  lastSuccessfulMobileConnection,
  mobileDeviceId,
  mobileQueueCount,
  recordSuccessfulMobileConnection,
  syncMobileQueue,
} from "../lib/mobile-client";
import { WorkIcon } from "./workspace-navigation";
import { MobileMediaEditor, type MobileMediaMarkup } from "./mobile-media-editor";
import { isPhotoUpload } from "../lib/photo-uploads";

type MobileActor = {
  name: string;
  email: string;
  accessLevel: string;
  designations: string[];
  permissionLocked?: boolean;
};

type DeviceSession = {
  id: string;
  userEmail: string;
  userName: string;
  deviceName: string;
  platform: string;
  status: string;
  biometricEnrolled: boolean;
  pushEnabled: boolean;
  lastSeenAt: string;
  offlineExpiresAt: string;
  revokedAt: string | null;
  revokedBy: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Props = {
  actor: MobileActor;
  active: string;
  projectId: string;
  projectName: string;
  notificationCount: number;
  onNavigate: (target: string) => void;
  onOpenMenu: () => void;
  onOpenNotifications: () => void;
  onQuickAdd: (action: MobileQuickAction) => void;
  onNotice: (message: string) => void;
};

export function MobileCommandCenter({
  actor,
  active,
  projectId,
  projectName,
  notificationCount,
  onNavigate,
  onOpenMenu,
  onOpenNotifications,
  onQuickAdd,
  onNotice,
}: Props) {
  const [online, setOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installGuide, setInstallGuide] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanType, setScanType] = useState("Receipt");
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanText, setScanText] = useState("");
  const [scanSaving, setScanSaving] = useState(false);
  const [scanReading, setScanReading] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanProgressLabel, setScanProgressLabel] = useState("");
  const [scanMarkup, setScanMarkup] = useState<MobileMediaMarkup | null>(null);
  const [scanMarkupOpen, setScanMarkupOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [currentDevice, setCurrentDevice] = useState<DeviceSession | null>(null);
  const [canAdministerDevices, setCanAdministerDevices] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [offlineLocked, setOfflineLocked] = useState(false);
  const [quickUnlockRequired, setQuickUnlockRequired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const bypassButton = useRef<HTMLButtonElement | null>(null);
  const quickActions = useMemo(() => quickActionsForActor(actor), [actor]);

  const refreshQueue = useCallback(() => {
    void mobileQueueCount().then(setQueueCount).catch(() => setQueueCount(0));
  }, []);

  const loadDevices = useCallback(async () => {
    const fingerprint = mobileDeviceId();
    const response = await fetch(`/api/mobile/device?deviceId=${encodeURIComponent(fingerprint)}`, { cache: "no-store" });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) await clearOfflineMobileData();
      return;
    }
    const result = await response.json() as { sessions?: DeviceSession[]; canAdminister?: boolean; currentSessionId?: string };
    const next = result.sessions || [];
    setDevices(next);
    setCanAdministerDevices(result.canAdminister === true);
    const current = next.find((session) => session.id === result.currentSessionId && session.status === "Trusted" && session.userEmail === actor.email);
    setCurrentDevice(current || null);
    if (current?.biometricEnrolled && isInstalledMobile() && shouldRequireQuickUnlock()) setQuickUnlockRequired(true);
  }, [actor.email]);

  const registerDevice = useCallback(async (action: "register" | "seen" = "seen") => {
    if (!navigator.onLine || actor.permissionLocked) return false;
    const response = await fetch("/api/mobile/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        deviceId: mobileDeviceId(),
        deviceName: deviceName(),
        platform: devicePlatform(),
      }),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        await clearOfflineMobileData();
        setOfflineLocked(true);
      }
      return false;
    }
    const result = await response.json() as { session?: DeviceSession };
    recordSuccessfulMobileConnection(result.session?.lastSeenAt || new Date().toISOString());
    setOfflineLocked(false);
    if (result.session) setCurrentDevice(result.session);
    return true;
  }, [actor.permissionLocked]);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    setSyncLabel("Checking offline work");
    try {
      const result = await syncMobileQueue((progress) => setSyncLabel(progress.label));
      await registerDevice("seen");
      refreshQueue();
      if (result.completed) {
        onNotice(
          result.conflicts
            ? `${result.completed} offline item${result.completed === 1 ? "" : "s"} synced. ${result.conflicts} conflict${result.conflicts === 1 ? " was" : "s were"} preserved for PM review.`
            : `${result.completed} offline item${result.completed === 1 ? "" : "s"} synced successfully.`,
        );
      }
    } catch (error) {
      setSyncLabel("Sync needs attention");
      onNotice(error instanceof Error ? error.message : "Offline work remains safely queued.");
    } finally {
      setSyncing(false);
      window.setTimeout(() => setSyncLabel(""), 2400);
    }
  }, [onNotice, refreshQueue, registerDevice, syncing]);

  useEffect(() => {
    const runningInstalled = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const priorConnection = lastSuccessfulMobileConnection();
    queueMicrotask(() => {
      setOnline(navigator.onLine);
      refreshQueue();
      if (
        (window.matchMedia("(max-width: 1400px) and (pointer: coarse)").matches || isIOSDevice()) &&
        !runningInstalled &&
        window.localStorage.getItem("command-install-guide-dismissed") !== "1"
      ) {
        setInstallGuide(true);
      }
      setOfflineLocked(!navigator.onLine && offlineSessionExpired(priorConnection || new Date(0).toISOString()));
    });
    if (actor.permissionLocked) {
      void clearOfflineMobileData();
      queueMicrotask(() => setOfflineLocked(true));
      return;
    }
    queueMicrotask(() => void registerDevice("register").then(() => loadDevices()));
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
    const handleOnline = () => {
      setOnline(true);
      void registerDevice("seen").then(() => syncNow());
    };
    const handleOffline = () => {
      setOnline(false);
      const last = lastSuccessfulMobileConnection();
      setOfflineLocked(offlineSessionExpired(last || new Date(0).toISOString()));
    };
    const handleQueue = () => refreshQueue();
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void registerDevice("seen");
    };
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (window.localStorage.getItem("command-install-guide-dismissed") !== "1") setInstallGuide(true);
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "COMMAND_MOBILE_SYNC") void syncNow();
      if (event.data?.type === "COMMAND_MOBILE_SYNC_PROGRESS") {
        setSyncing(true);
        setSyncLabel(String(event.data.label || "Uploading offline work"));
      }
      if (event.data?.type === "COMMAND_MOBILE_SYNC_COMPLETE") {
        setSyncing(false);
        setSyncLabel(event.data.completed ? `${event.data.completed} offline item${event.data.completed === 1 ? "" : "s"} uploaded in the background` : "Offline work remains queued");
        refreshQueue();
        window.setTimeout(() => setSyncLabel(""), 2800);
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("command-mobile-queue-changed", handleQueue);
    window.addEventListener("beforeinstallprompt", handleInstall);
    document.addEventListener("visibilitychange", handleVisibility);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("command-mobile-queue-changed", handleQueue);
      window.removeEventListener("beforeinstallprompt", handleInstall);
      document.removeEventListener("visibilitychange", handleVisibility);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [actor.permissionLocked, loadDevices, refreshQueue, registerDevice, syncNow]);

  useEffect(() => {
    if (!currentDevice?.biometricEnrolled || !isInstalledMobile()) return;
    let hiddenAt = 0;
    const lockAfterBackground = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt >= 5 * 60 * 1000) setQuickUnlockRequired(true);
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", lockAfterBackground);
    return () => document.removeEventListener("visibilitychange", lockAfterBackground);
  }, [currentDevice?.biometricEnrolled]);

  async function installCommandCenter() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallGuide(false);
      setInstallPrompt(null);
      return;
    }
    setInstallGuide(true);
  }

  function dismissInstallGuide() {
    window.localStorage.setItem("command-install-guide-dismissed", "1");
    setInstallGuide(false);
  }

  async function enableFaceId() {
    if (!("credentials" in navigator) || typeof PublicKeyCredential === "undefined") {
      onNotice("This device does not expose a platform biometric authenticator. Microsoft sign-in remains available.");
      return;
    }
    setBiometricBusy(true);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(24));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Mefford Contracting" },
          user: { id: userId, name: actor.email, displayName: actor.name },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
          timeout: 60_000,
          attestation: "none",
        },
      }) as PublicKeyCredential | null;
      if (!credential) throw new Error("Face ID enrollment was cancelled.");
      const attestation = credential.response as AuthenticatorAttestationResponse & {
        getPublicKey?: () => ArrayBuffer | null;
        getPublicKeyAlgorithm?: () => number;
      };
      const publicKey = attestation.getPublicKey?.() || null;
      const algorithm = attestation.getPublicKeyAlgorithm?.();
      if (!publicKey || !algorithm) throw new Error("This browser did not provide a verifiable platform credential. Microsoft sign-in remains available.");
      const credentialId = bufferToBase64Url(credential.rawId);
      const response = await fetch("/api/mobile/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "biometric-enroll", deviceId: mobileDeviceId(), credentialId, publicKey: bufferToBase64Url(publicKey), algorithm }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Face ID could not be enrolled.");
      setCurrentDevice((current) => current ? { ...current, biometricEnrolled: true } : current);
      recordQuickUnlock();
      await loadDevices();
      onNotice("Face ID is now required immediately before sensitive mobile actions.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Face ID enrollment did not finish.");
    } finally {
      setBiometricBusy(false);
    }
  }

  const confirmSensitiveAction = useCallback(async (actionLabel: string) => {
    setBiometricBusy(true);
    try {
      const challengeResponse = await fetch("/api/mobile/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "step-up-challenge", deviceId: mobileDeviceId() }),
      });
      const challengeData = await challengeResponse.json() as { challenge?: string; credentialId?: string; rpId?: string; error?: string };
      if (!challengeResponse.ok || !challengeData.challenge || !challengeData.credentialId) throw new Error(challengeData.error || "Face ID confirmation could not start.");
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64UrlToBuffer(challengeData.challenge),
          allowCredentials: [{ type: "public-key", id: base64UrlToBuffer(challengeData.credentialId) }],
          rpId: challengeData.rpId,
          userVerification: "required",
          timeout: 60_000,
        },
      }) as PublicKeyCredential | null;
      if (!credential) throw new Error("Face ID confirmation was cancelled.");
      const assertion = credential.response as AuthenticatorAssertionResponse;
      const verify = await fetch("/api/mobile/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "step-up-verify",
          deviceId: mobileDeviceId(),
          challenge: challengeData.challenge,
          assertionId: bufferToBase64Url(credential.rawId),
          authenticatorData: bufferToBase64Url(assertion.authenticatorData),
          clientDataJSON: bufferToBase64Url(assertion.clientDataJSON),
          signature: bufferToBase64Url(assertion.signature),
          actionLabel,
        }),
      });
      const verified = await verify.json() as { verified?: boolean; error?: string };
      if (!verify.ok || !verified.verified) throw new Error(verified.error || "Face ID was not confirmed.");
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Face ID was not confirmed.");
      return false;
    } finally {
      setBiometricBusy(false);
    }
  }, [onNotice]);

  useEffect(() => {
    const interceptSensitiveAction = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button");
      if (
        !button ||
        button === bypassButton.current ||
        button.dataset.biometricExempt === "vendor-temporary-approval" ||
        !isSensitiveActionLabel(button.innerText || button.getAttribute("aria-label") || "")
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const label = (button.innerText || button.getAttribute("aria-label") || "Sensitive Action").trim();
      if (!navigator.onLine) {
        onNotice("A live connection is required for financial approvals, Owner overrides, contract execution, final payment and Total Project Closeout.");
        return;
      }
      if (!currentDevice?.biometricEnrolled) {
        setSecurityOpen(true);
        onNotice("Enroll Face ID on this trusted device before completing this sensitive action.");
        return;
      }
      void confirmSensitiveAction(label).then((verified) => {
        if (!verified) return;
        bypassButton.current = button;
        button.click();
        window.setTimeout(() => { bypassButton.current = null; }, 0);
      });
    };
    document.addEventListener("click", interceptSensitiveAction, true);
    return () => document.removeEventListener("click", interceptSensitiveAction, true);
  }, [confirmSensitiveAction, currentDevice?.biometricEnrolled, onNotice]);

  async function enablePushNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      onNotice("Push notifications are not available in this browser. Install Command Center on the Home Screen first.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      onNotice("Push notifications remain off. They can be enabled later in device settings.");
      return;
    }
    const configResponse = await fetch("/api/mobile/device?action=push-config", { cache: "no-store" });
    const config = await configResponse.json() as { vapidPublicKey?: string; error?: string };
    if (!configResponse.ok || !config.vapidPublicKey) {
      onNotice(config.error || "Command Center push delivery is not configured yet.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription().catch(() => null);
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBuffer(config.vapidPublicKey),
      }).catch(() => null);
    }
    if (!subscription) {
      onNotice("Notification permission was granted, but this browser could not create a secure push subscription.");
      return;
    }
    const response = await fetch("/api/mobile/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "push-preference",
        deviceId: mobileDeviceId(),
        enabled: true,
        subscription: subscription.toJSON(),
      }),
    });
    if (!response.ok) {
      onNotice("Push permission was granted, but the device could not be registered.");
      return;
    }
    setCurrentDevice((current) => current ? { ...current, pushEnabled: true } : current);
    onNotice("Operational push notifications are enabled for this trusted device.");
  }

  async function revokeDevice(session: DeviceSession) {
    const response = await fetch("/api/mobile/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", sessionId: session.id, reason: "Revoked from Command Center device security" }),
    });
    if (!response.ok) {
      onNotice("The device session could not be revoked.");
      return;
    }
    if (session.id === currentDevice?.id) {
      await clearOfflineMobileData();
      navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_MOBILE_CACHE" });
      setOfflineLocked(true);
    }
    await loadDevices();
    onNotice(`${session.deviceName} was revoked and its mobile access was disabled.`);
  }

  async function saveScan() {
    if (!scanFile || !online) {
      onNotice(online ? "Capture or choose a document first." : "Document OCR upload will be available when the device reconnects.");
      return;
    }
    setScanSaving(true);
    try {
      const form = new FormData();
      form.set("file", scanFile);
      form.set("projectId", projectId);
      form.set("category", "Mobile Scans");
      form.set("revision", `${scanType} · OCR Review`);
      form.set("access", "Project team");
      const upload = await fetch("/api/files", { method: "POST", body: form });
      if (!upload.ok) throw new Error("The document scan could not upload.");
      if (scanMarkup?.annotatedFile) {
        const markedForm = new FormData();
        markedForm.set("file", scanMarkup.annotatedFile);
        markedForm.set("projectId", projectId);
        markedForm.set("category", "Mobile Scans");
        markedForm.set("revision", `${scanType} · Marked Copy · Original Preserved`);
        markedForm.set("access", "Project team");
        const markedUpload = await fetch("/api/files", { method: "POST", body: markedForm });
        if (!markedUpload.ok) throw new Error("The original uploaded, but the marked copy still needs attention.");
      }
      const id = `SCAN-${Date.now().toString(36).toUpperCase()}`;
      const recordResponse = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          recordType: "Mobile Scans",
          record: {
            id,
            title: `${scanType} · ${scanFile.name}`,
            owner: actor.name,
            due: new Date().toLocaleDateString("en-US"),
            status: "OCR Review",
            meta: "Original preserved · Searchable text requires review before use",
            data: {
              scanType,
              sourceFile: scanFile.name,
              extractedText: scanText,
              ocrCompleted: Boolean(scanText.trim()),
              ocrReviewRequired: true,
              capturedOnTrustedDevice: true,
              originalPreserved: true,
              markedCopy: scanMarkup?.annotatedFile?.name || "",
              caption: scanMarkup?.caption || "",
              beforeAfterRole: scanMarkup?.pairRole || "Standalone",
              beforeAfterReference: scanMarkup?.pairReference || "",
              markupOperationCount: scanMarkup?.operationCount || 0,
            },
            initialAudit: `Captured By ${actor.name} On Trusted Mobile Device`,
          },
        }),
      });
      if (!recordResponse.ok) throw new Error("The scan uploaded, but its OCR review record could not be created.");
      setScanOpen(false);
      setQuickOpen(false);
      setScanFile(null);
      setScanText("");
      setScanMarkup(null);
      onNotice(`${scanType} captured. The original is preserved and its OCR review record is ready.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The scan could not be saved.");
    } finally {
      setScanSaving(false);
    }
  }

  async function selectScanFile(file: File | null) {
    setScanFile(file);
    setScanText("");
    setScanMarkup(null);
    setScanProgress(0);
    setScanProgressLabel("");
    if (!file) return;
    if (!navigator.onLine) {
      setScanProgressLabel("OCR will run after reconnection; the original remains on this device.");
      return;
    }
    await runOcr(file);
  }

  async function runOcr(file = scanFile) {
    if (!file || scanReading) return;
    setScanReading(true);
    setScanProgress(1);
    setScanProgressLabel("Starting OCR");
    try {
      const { recognizeMobileDocument } = await import("../lib/mobile-ocr");
      const text = await recognizeMobileDocument(file, (progress) => {
        setScanProgress(progress.percent);
        setScanProgressLabel(progress.label);
      });
      setScanText(text);
      if (!text.trim()) setScanProgressLabel("No text was detected. Review the image and enter any needed text manually.");
    } catch (error) {
      setScanProgressLabel(error instanceof Error ? `OCR needs review: ${error.message}` : "OCR needs review. Enter text manually if needed.");
    } finally {
      setScanReading(false);
    }
  }

  async function unlockWithFaceId() {
    setUnlocking(true);
    const verified = await confirmSensitiveAction("Trusted Device Session Unlock");
    if (verified) {
      recordQuickUnlock();
      setQuickUnlockRequired(false);
    }
    setUnlocking(false);
  }

  function startDictation() {
    const target = document.activeElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      onNotice("Tap a notes or text field first, then use the microphone.");
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onNotice("Voice-to-text is unavailable in this browser. The device keyboard microphone remains supported.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setDictating(true);
    recognition.onend = () => setDictating(false);
    recognition.onerror = () => {
      setDictating(false);
      onNotice("Dictation stopped without changing the field.");
    };
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript || "").join(" ").trim();
      if (!transcript) return;
      const nextValue = `${target.value}${target.value.trim() ? " " : ""}${transcript}`;
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(target, nextValue);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.focus();
      onNotice("Dictation added for your review. It was not submitted automatically.");
    };
    recognition.start();
  }

  function selectPrimary(id: string) {
    if (id === "work") onNavigate("My Work");
    if (id === "project") onNavigate("Project Overview");
    if (id === "quick") setQuickOpen(true);
    if (id === "notifications") onOpenNotifications();
    if (id === "more") onOpenMenu();
  }

  const installed = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  if (actor.permissionLocked) return null;

  return (
    <>
      <div className={`mobile-connectivity ${online ? "online" : "offline"} ${queueCount ? "has-queue" : ""}`} role="status" aria-live="polite">
        <span aria-hidden="true" />
        <strong>{online ? (syncing ? syncLabel || "Syncing" : "Online") : "Offline Field Mode"}</strong>
        {queueCount ? <button onClick={() => void syncNow()} disabled={!online || syncing}>{queueCount} Upload{queueCount === 1 ? "" : "s"} Waiting · {online ? "Upload Now" : "Saved On Device"}</button> : <small>{online ? "No Uploads Waiting" : "Saved On Device · Uploads Resume When Online"}</small>}
      </div>

      {!installed && installGuide ? (
        <section className="mobile-install-guide" aria-label="Install Command Center">
          <span className="mobile-install-icon">MC</span>
          <div>
            <strong>Add Command Center To This Device</strong>
            <p>{installPrompt ? "Install for faster full-screen access, offline field work and notifications." : "On iPhone or iPad: tap Share, then Add to Home Screen."}</p>
          </div>
          <button className="mobile-install-action" onClick={() => void installCommandCenter()}>{installPrompt ? "Install" : "How To"}</button>
          <button className="mobile-install-dismiss" aria-label="Dismiss installation guide" onClick={dismissInstallGuide}>×</button>
        </section>
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        {MOBILE_PRIMARY_NAVIGATION.map((item) => {
          const selected = (item.id === "work" && active === "My Work") || (item.id === "project" && active === "Project Overview");
          return (
            <button key={item.id} className={`${selected ? "active" : ""} ${item.id === "quick" ? "quick" : ""}`} aria-current={selected ? "page" : undefined} aria-label={item.label} onClick={() => selectPrimary(item.id)}>
              <span><WorkIcon name={item.id === "work" ? "work" : item.id === "project" ? "project" : item.id === "notifications" ? "bell" : item.id === "quick" ? "camera" : "grid"} /></span>
              <small>{item.id === "notifications" ? "Alerts" : item.label}</small>
              {item.id === "notifications" && notificationCount ? <b>{notificationCount > 99 ? "99+" : notificationCount}</b> : null}
            </button>
          );
        })}
      </nav>

      {quickOpen ? (
        <div className="mobile-sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setQuickOpen(false)}>
          <section className="mobile-sheet mobile-quick-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-quick-title">
            <header>
              <div><span>QUICK ADD · {projectName.toUpperCase()}</span><h2 id="mobile-quick-title">Create From The Field</h2><p>Project, user, date and time are filled automatically.</p></div>
              <button aria-label="Close Quick Add" onClick={() => setQuickOpen(false)}>×</button>
            </header>
            <div className="mobile-quick-grid">
              {quickActions.map((action) => (
                <button key={action.id} onClick={() => { setQuickOpen(false); onQuickAdd(action); }}>
                  <span>{action.icon}</span><strong>{action.label}</strong><small>{online ? "Open" : "Queues offline when allowed"}</small>
                </button>
              ))}
            </div>
            <button className="mobile-scan-action" onClick={() => setScanOpen(true)}><span>▣</span><strong>Scan & OCR A Document</strong><small>Receipt, invoice, permit, lien release, delivery ticket or equipment information</small><b>→</b></button>
            <footer><span>◎ Location is requested only when you submit a field record.</span><span>✦ Originals are always preserved.</span></footer>
          </section>
        </div>
      ) : null}

      {securityOpen ? (
        <div className="mobile-sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSecurityOpen(false)}>
          <section className="mobile-sheet mobile-security-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-security-title">
            <header><div><span>TRUSTED DEVICE SECURITY</span><h2 id="mobile-security-title">Mobile Access & Face ID</h2><p>Microsoft identity remains the account authority. Face ID unlocks and confirms sensitive actions on this trusted device.</p></div><button aria-label="Close Device Security" onClick={() => setSecurityOpen(false)}>×</button></header>
            <div className="mobile-security-current">
              <span>◉</span><div><strong>{deviceName()}</strong><small>{online ? "Connected" : "Offline"} · Seven-day rolling offline trust</small></div><b>{currentDevice?.status || "Registering"}</b>
            </div>
            <div className="mobile-security-actions">
              <button onClick={() => void enableFaceId()} disabled={biometricBusy || currentDevice?.biometricEnrolled}><span>FACE ID</span><strong>{currentDevice?.biometricEnrolled ? "Face ID Ready" : "Enable Face ID"}</strong><small>Required immediately before financial approvals, Owner overrides, contract execution, final payment and Total Closeout.</small></button>
              <button onClick={() => void enablePushNotifications()} disabled={currentDevice?.pushEnabled}><span>PUSH</span><strong>{currentDevice?.pushEnabled ? "Push Enabled" : "Enable Notifications"}</strong><small>{MOBILE_PUSH_CATEGORIES.join(" · ")}</small></button>
              {!installed ? <button onClick={() => void installCommandCenter()}><span>APP</span><strong>Add To Home Screen</strong><small>Same Command Center website with full-screen access and automatic updates.</small></button> : null}
            </div>
            <div className="mobile-device-list">
              <div><strong>{canAdministerDevices ? "Company Device Sessions" : "My Device Sessions"}</strong><small>Every phone and tablet is separately audited and remotely revocable.</small></div>
              {devices.map((session) => (
                <article key={session.id}><span className={session.status === "Trusted" ? "trusted" : "revoked"} /><div><strong>{session.deviceName}</strong><small>{session.userName} · {formatDeviceDate(session.lastSeenAt)} · {session.biometricEnrolled ? "Face ID" : "Passcode fallback"}</small></div><b>{session.status}</b>{session.status === "Trusted" ? <button onClick={() => void revokeDevice(session)}>Revoke</button> : null}</article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {scanOpen ? (
        <div className="mobile-sheet-layer scan-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setScanOpen(false)}>
          <section className="mobile-sheet mobile-scan-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-scan-title">
            <header><div><span>DOCUMENT CAMERA</span><h2 id="mobile-scan-title">Scan & OCR</h2><p>The unmodified original remains attached to the permanent project record.</p></div><button aria-label="Close Document Scanner" onClick={() => setScanOpen(false)}>×</button></header>
            <label className="mobile-scan-type">Document Type<select value={scanType} onChange={(event) => setScanType(event.target.value)}>{MOBILE_SCAN_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="mobile-document-capture"><input type="file" capture="environment" onChange={(event) => void selectScanFile(event.target.files?.[0] || null)} /><span>▣</span><strong>{scanFile?.name || "Use Camera Or Choose Document"}</strong><small>Any File Type · OCR When Readable · Original Preserved</small></label>
            {scanFile ? <div className="mobile-ocr-progress" role="status" aria-live="polite"><div><i style={{ width: `${scanProgress}%` }} /></div><span>{scanProgressLabel || "Ready for OCR"}</span><button type="button" disabled={scanReading || !online} onClick={() => void runOcr()}>{scanReading ? `${scanProgress}%` : "Run OCR Again"}</button></div> : null}
            <label className="mobile-ocr-review">OCR Text Review<textarea value={scanText} onChange={(event) => setScanText(event.target.value)} rows={6} placeholder="Extracted text appears here for review. Correct any field before relying on it." /></label>
            <div className="mobile-scan-tools" aria-label="Photo markup tools"><span>Markup:</span><button type="button" disabled={!scanFile || !isPhotoUpload(scanFile)} onClick={() => setScanMarkupOpen(true)}>→ ◯ T Open Editor</button><button type="button" disabled={!scanMarkup} onClick={() => setScanMarkupOpen(true)}>↔ {scanMarkup?.pairRole || "Before / After"}</button><b>{scanMarkup ? `${scanMarkup.operationCount} marks · ${scanMarkup.pairRole}` : "Original remains unchanged"}</b></div>
            <footer><button className="secondary-action" onClick={() => setScanOpen(false)}>Cancel</button><button className="primary-action large" disabled={!scanFile || scanSaving || scanReading || !online} onClick={() => void saveScan()}>{scanSaving ? "Saving Original..." : online ? "Save Original & OCR Record" : "Reconnect To Save Scan"}</button></footer>
          </section>
        </div>
      ) : null}

      {scanMarkupOpen && scanFile && isPhotoUpload(scanFile) ? <MobileMediaEditor file={scanFile} initial={scanMarkup || undefined} onCancel={() => setScanMarkupOpen(false)} onSave={(markup) => { setScanMarkup(markup); setScanMarkupOpen(false); }} /> : null}

      <button className="mobile-security-fab" aria-label="Open mobile device security" onClick={() => setSecurityOpen(true)}>⌁</button>
      <button
        className={`mobile-dictation-fab ${dictating ? "listening" : ""}`}
        aria-label={dictating ? "Listening for dictation" : "Dictate into focused field"}
        onPointerDown={(event) => event.preventDefault()}
        onClick={startDictation}
      >
        {dictating ? "●" : "MIC"}
      </button>

      {offlineLocked ? (
        <div className="mobile-offline-lock" role="alertdialog" aria-modal="true" aria-labelledby="offline-lock-title">
          <section><span>MC</span><h2 id="offline-lock-title">Sign-In Required</h2><p>This device has been offline for more than seven days, its session was revoked, or onboarding access is locked. Assigned-project data is unavailable until Microsoft identity is confirmed again.</p><a href="/signin-with-chatgpt?return_to=%2F">Sign In To Command Center</a><small>Regular connected use renews the trusted session automatically—there is no weekly login requirement.</small></section>
        </div>
      ) : null}

      {quickUnlockRequired && !offlineLocked ? (
        <div className="mobile-quick-lock" role="dialog" aria-modal="true" aria-labelledby="mobile-quick-lock-title">
          <section><span>MC</span><p>TRUSTED DEVICE</p><h2 id="mobile-quick-lock-title">Unlock Command Center</h2><small>Microsoft identity remains signed in. Face ID quickly unlocks this separately audited device session.</small><button type="button" onClick={() => void unlockWithFaceId()} disabled={unlocking}>{unlocking ? "Confirming..." : "Unlock With Face ID"}</button><a href="/signin-with-chatgpt?return_to=%2F">Use Account Sign-In Instead</a></section>
        </div>
      ) : null}
    </>
  );
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  start: () => void;
};

function deviceName() {
  if (typeof navigator === "undefined") return "Command Center Device";
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad · Command Center";
  if (/iPhone/i.test(ua)) return "iPhone · Command Center";
  if (/Android/i.test(ua)) return "Android · Command Center";
  return "Browser · Command Center";
}

function isInstalledMobile() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function shouldRequireQuickUnlock() {
  if (typeof window === "undefined") return false;
  const last = Number(window.localStorage.getItem("command-mobile-last-biometric-unlock") || 0);
  return !last || Date.now() - last >= 5 * 60 * 1000;
}

function recordQuickUnlock() {
  if (typeof window !== "undefined") window.localStorage.setItem("command-mobile-last-biometric-unlock", String(Date.now()));
}

function devicePlatform() {
  if (typeof navigator === "undefined") return "Web App";
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  return `${navigator.platform || "Web"} · ${installed ? "Installed Web App" : "Browser"}`;
}

function formatDeviceDate(value: string) {
  if (!value) return "Not yet connected";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function bufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

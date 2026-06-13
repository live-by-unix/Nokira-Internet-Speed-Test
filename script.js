// --- DOM Elements ---
const themeSwitch = document.getElementById("themeSwitch");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("statusText");
const errorText = document.getElementById("errorText");

const speedValueEl = document.getElementById("speedValue");
const speedLabelEl = document.getElementById("speedLabel");
const gaugeArc = document.getElementById("gaugeArc");

const pingValueEl = document.getElementById("pingValue");
const jitterValueEl = document.getElementById("jitterValue");
const serverValueEl = document.getElementById("serverValue");
const locationValueEl = document.getElementById("locationValue");

const resultsPanel = document.getElementById("resultsPanel");
const ispPill = document.getElementById("ispPill");

const downResultEl = document.getElementById("downResult");
const upResultEl = document.getElementById("upResult");
const pingResultEl = document.getElementById("pingResult");
const jitterResultEl = document.getElementById("jitterResult");

const prosListEl = document.getElementById("prosList");
const consListEl = document.getElementById("consList");

const copyBtn = document.getElementById("copyBtn");
const emailBtn = document.getElementById("emailBtn");

// --- Constants ---
const GAUGE_MAX_MBPS = 500;
const GAUGE_LENGTH = 503;

const CF_PING = "https://speed.cloudflare.com/__down?bytes=1";
const CF_DOWN = "https://speed.cloudflare.com/__down?bytes=10000000"; // ~10MB chunks
const UPLOAD_TARGET = "https://httpbin.org/anything";                 // Verified, globally open CORS wildcard endpoint
const IP_INFO = "https://ipapi.co/json/";

// --- State Management ---
let lastSpeedDisplay = 0;
let lastResults = {
  download: null,
  upload: null,
  ping: null,
  jitter: null,
  isp: "Unknown",
  ip: null,
  city: null,
  region: null,
  country: null,
};

// --- Theme Initialization & Management ---
function initTheme() {
  const saved = localStorage.getItem("nokira-theme");
  const theme = saved === "light" ? "light" : "dark";
  document.body.setAttribute("data-theme", theme);
  if (themeSwitch) themeSwitch.checked = theme === "light";
}

if (themeSwitch) {
  themeSwitch.addEventListener("change", () => {
    const theme = themeSwitch.checked ? "light" : "dark";
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("nokira-theme", theme);
  });
}

// --- UI Animations & Gauge Controls ---
function animateSpeed(target, label) {
  const start = lastSpeedDisplay;
  const duration = 150; 
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const value = start + (target - start) * eased;
    if (speedValueEl) speedValueEl.textContent = value.toFixed(2);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      lastSpeedDisplay = target;
    }
  }

  if (speedLabelEl) speedLabelEl.textContent = label;
  requestAnimationFrame(step);
}

function updateGauge(mbps) {
  if (!gaugeArc) return;
  const clamped = Math.max(0, Math.min(GAUGE_MAX_MBPS, mbps));
  const ratio = clamped / GAUGE_MAX_MBPS;
  gaugeArc.style.strokeDashoffset = (GAUGE_LENGTH - GAUGE_LENGTH * ratio).toString();
}

// --- 1. Latency & Jitter Engine ---
async function measurePingAndJitter(iter = 20) {
  const times = [];

  try {
    await fetch(`${CF_PING}&warmup=${Math.random()}`, { cache: "no-store", mode: "no-cors" });
  } catch (e) {}

  for (let i = 0; i < iter; i++) {
    const start = performance.now();
    try {
      await fetch(`${CF_PING}&cacheBust=${Math.random()}`, { cache: "no-store", mode: "no-cors" });
      times.push(performance.now() - start);
    } catch {
      times.push(220); 
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  times.sort((a, b) => a - b);
  const cut = Math.floor(times.length * 0.1);
  const trimmed = times.slice(cut, times.length - cut);

  const avgPing = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

  let jitterSum = 0;
  for (let i = 1; i < trimmed.length; i++) {
    jitterSum += Math.abs(trimmed[i] - trimmed[i - 1]);
  }
  const jitter = jitterSum / (trimmed.length - 1 || 1);

  return { ping: avgPing, jitter };
}

// --- 2. High-Speed Stream-Safe Download Engine ---
async function measureDownload() {
  const testDuration = 8000; 
  const rampUpTime = 2000;    
  const numStreams = 3;      
  
  let totalBytesLoaded = 0;
  let bytesAfterRampUp = 0;
  let rampUpPassed = false;
  let rampUpStartTime = 0;
  
  const startTime = performance.now();
  const controller = new AbortController();

  setTimeout(() => {
    rampUpPassed = true;
    rampUpStartTime = performance.now();
  }, rampUpTime);

  const downloadStream = async (streamIndex) => {
    while (performance.now() - startTime < testDuration && !controller.signal.aborted) {
      try {
        const uniqueUrl = `${CF_DOWN}&stream=${streamIndex}&nocache=${Math.random()}`;
        const response = await fetch(uniqueUrl, {
          cache: "no-store",
          mode: "cors", 
          signal: controller.signal
        });

        if (!response.body) {
          const blob = await response.blob();
          totalBytesLoaded += blob.size;
          if (rampUpPassed) bytesAfterRampUp += blob.size;
          continue;
        }

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunkLength = value.byteLength;
          totalBytesLoaded += chunkLength;
          if (rampUpPassed) {
            bytesAfterRampUp += chunkLength;
          }
          
          if (performance.now() - startTime >= testDuration) {
            controller.abort();
            break;
          }
        }
      } catch (e) {
        if (e.name !== "AbortError") console.warn(e);
        break;
      }
    }
  };

  const uiInterval = setInterval(() => {
    const now = performance.now();
    const elapsedTotal = (now - startTime) / 1000;
    
    let currentMbps = 0;
    if (rampUpPassed) {
      const elapsedActive = (now - rampUpStartTime) / 1000;
      currentMbps = (bytesAfterRampUp * 8) / elapsedActive / 1_000_000;
    } else {
      currentMbps = (totalBytesLoaded * 8) / elapsedTotal / 1_000_000;
    }

    if (elapsedTotal > 0.3) {
      animateSpeed(currentMbps, "Download…");
      updateGauge(currentMbps);
    }
  }, 200);

  const streams = Array.from({ length: numStreams }, (_, i) => downloadStream(i));
  
  await Promise.race([
    Promise.all(streams),
    new Promise(r => setTimeout(() => { controller.abort(); r(); }, testDuration))
  ]);

  clearInterval(uiInterval);
  
  const finalElapsedActive = (performance.now() - rampUpStartTime) / 1000;
  return finalElapsedActive > 0 ? (bytesAfterRampUp * 8) / finalElapsedActive / 1_000_000 : 0;
}

// --- 3. High-Speed Upload Engine (CORS-Compliant Verified Pipeline) ---
function measureUpload() {
  return new Promise((resolve) => {
    const testDuration = 8000;
    const rampUpTime = 2000;
    const numStreams = 3;        // Multi-stream layout to effectively fill up your fiber line
    const chunkSize = 2000000;   // ~2MB blocks prevent multi-threaded socket crashes
    
    const payload = new Uint8Array(chunkSize);
    const maxEntropySize = 65536; 
    const randomSeed = new Uint8Array(maxEntropySize);
    crypto.getRandomValues(randomSeed);

    for (let offset = 0; offset < chunkSize; offset += maxEntropySize) {
      const sizeToCopy = Math.min(maxEntropySize, chunkSize - offset);
      payload.set(randomSeed.subarray(0, sizeToCopy), offset);
    }

    let activeStreams = [];
    let bytesUploadedAfterRamp = 0;
    let startTime = performance.now();
    let rampUpStartTime = startTime + rampUpTime;
    let isRampUpPassed = false;

    setTimeout(() => { isRampUpPassed = true; }, rampUpTime);

    const startXHRStream = () => {
      if (performance.now() - startTime >= testDuration) return;

      const xhr = new XMLHttpRequest();
      activeStreams.push(xhr);
      
      // Pointing directly to the open wildcard route
      xhr.open("POST", `${UPLOAD_TARGET}?nocache=${Math.random()}`, true);
      
      let lastLoaded = 0;
      xhr.upload.onprogress = (event) => {
        if (performance.now() - startTime >= testDuration) {
          xhr.abort();
          return;
        }
        
        const delta = event.loaded - lastLoaded;
        lastLoaded = event.loaded;

        if (isRampUpPassed) {
          bytesUploadedAfterRamp += delta;
        }
      };

      xhr.onload = xhr.onerror = () => {
        startXHRStream();
      };

      xhr.send(payload);
    };

    const uiInterval = setInterval(() => {
      const now = performance.now();
      if (isRampUpPassed && now > rampUpStartTime) {
        const elapsedActive = (now - rampUpStartTime) / 1000;
        const currentMbps = (bytesUploadedAfterRamp * 8) / elapsedActive / 1_000_000;
        animateSpeed(currentMbps, "Upload…");
        updateGauge(currentMbps);
      }
    }, 200);

    for (let i = 0; i < numStreams; i++) {
      startXHRStream();
    }

    setTimeout(() => {
      clearInterval(uiInterval);
      activeStreams.forEach(xhr => { try { xhr.abort(); } catch(e){} });
      
      const finalElapsedActive = (performance.now() - rampUpStartTime) / 1000;
      const finalMbps = finalElapsedActive > 0 ? (bytesUploadedAfterRamp * 8) / finalElapsedActive / 1_000_000 : 0;
      resolve(finalMbps);
    }, testDuration);
  });
}

// --- Metadata & Diagnostics Helpers ---
async function fetchIPInfo() {
  try {
    const res = await fetch(IP_INFO, { cache: "no-store" });
    const data = await res.json();
    return {
      ip: data.ip || null,
      isp: data.org || data.asn || "Unknown",
      city: data.city || null,
      region: data.region || null,
      country: data.country_name || null,
    };
  } catch {
    return { ip: null, isp: "Unknown", city: null, region: null, country: null };
  }
}

function guessISP(info, down, up, ping) {
  const isp = (info.isp || "").toLowerCase();
  const symmetric = Math.abs(down - up) / Math.max(down, 1) < 0.25;

  if (isp.includes("google")) return "Likely Google Fiber";
  if (isp.includes("comcast") || isp.includes("xfinity")) return "Likely Xfinity";
  if (isp.includes("spectrum") || isp.includes("charter")) return "Likely Spectrum";
  if (isp.includes("verizon")) return symmetric ? "Likely Verizon Fios" : "Likely Verizon";
  if (isp.includes("at&t") || isp.includes("att")) return symmetric ? "Likely AT&T Fiber" : "Likely AT&T";
  if (isp.includes("cox")) return "Likely Cox";
  if (isp.includes("rogers")) return "Likely Rogers";
  if (isp.includes("bell")) return "Likely Bell";
  if (isp.includes("telus")) return "Likely Telus";
  if (isp.includes("virgin")) return "Likely Virgin Media";

  if (symmetric && down > 200) return "Likely Fiber Provider";
  if (!symmetric && down > 50 && up < 45) return "Likely Cable Provider";
  return info.isp;
}

function analyzeNetwork(down, up, ping, jitter) {
  const pros = [];
  const cons = [];

  if (down >= 400) pros.push("Excellent multi-device Gig/Fiber level throughput.");
  else if (down >= 200) pros.push("Great for HD/4K streaming and multitasking.");
  else if (down >= 50) pros.push("Good for HD streaming and browsing.");
  else cons.push("Download speed is low for modern streaming.");

  if (up >= 400) pros.push("Symmetric fiber uploading capabilities achieved.");
  else if (up >= 100) pros.push("Fantastic upload for streaming and cloud staging.");
  else if (up >= 20) pros.push("Strong upload for video calls.");
  else cons.push("Upload limitations detected.");

  if (ping <= 25) pros.push("Low latency connection excellent for real-time applications.");
  else if (ping <= 50) pros.push("Good operational latency for general web apps.");
  else cons.push("High latency affects real‑time apps.");

  if (jitter <= 5) pros.push("Rock-solid stability with near-zero connection variance.");
  else if (jitter <= 20) cons.push("Minor jitter detected.");
  else cons.push("High jitter suggests stream instability.");

  return {
    pros: [...new Set(pros)],
    cons: [...new Set(cons)],
  };
}

function renderProsCons(pros, cons) {
  if (prosListEl) prosListEl.innerHTML = "";
  if (consListEl) consListEl.innerHTML = "";

  pros.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p;
    if (prosListEl) prosListEl.appendChild(li);
  });

  cons.forEach((c) => {
    const li = document.createElement("li");
    li.textContent = c;
    if (consListEl) consListEl.appendChild(li);
  });
}

function generateShareText() {
  const r = lastResults;
  const prosItems = prosListEl ? Array.from(prosListEl.children).map((li) => li.textContent) : [];
  const consItems = consListEl ? Array.from(consListEl.children).map((li) => li.textContent) : [];

  return (
    "📡 Nokira Internet Speed Test Results\n" +
    "-----------------------------------\n" +
    (r.ip ? `IP: ${r.ip}\n` : "") +
    (r.city || r.region || r.country
      ? `Location: ${[r.city, r.region, r.country].filter(Boolean).join(", ")}\n`
      : "") +
    `Download: ${r.download?.toFixed(2) ?? "--"} Mbps\n` +
    `Upload:   ${r.upload?.toFixed(2) ?? "--"} Mbps\n` +
    `Ping:     ${r.ping?.toFixed(1) ?? "--"} ms\n` +
    `Jitter:   ${r.jitter?.toFixed(1) ?? "--"} ms\n` +
    `ISP:      ${r.isp}\n\n` +
    "Pros:\n" +
    prosItems.map((p) => "- " + p).join("\n") +
    "\n\nCons:\n" +
    consItems.map((c) => "- " + c).join("\n") +
    "\n\nTested with Nokira Internet Speed Test Engine."
  );
}

// --- Share and Action Listeners ---
if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(generateShareText());
      if (statusText) statusText.innerHTML = "<strong>Copied to clipboard!</strong>";
    } catch {
      if (statusText) statusText.textContent = "Copy failed.";
    }
  });
}

if (emailBtn) {
  emailBtn.addEventListener("click", () => {
    const subject = encodeURIComponent("My Nokira Internet Speed Test Results");
    const body = encodeURIComponent(generateShareText());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
}

// --- Main Test Suite Control Flow ---
async function runTest() {
  if (startBtn.classList.contains("disabled")) return;

  startBtn.classList.add("disabled");
  if (errorText) errorText.textContent = "";

  animateSpeed(0, "Preparing Core Engines…");
  updateGauge(0);
  if (statusText) statusText.textContent = "Locating closest node…";

  try {
    const ipInfo = await fetchIPInfo();
    lastResults.ip = ipInfo.ip;
    lastResults.city = ipInfo.city;
    lastResults.region = ipInfo.region;
    lastResults.country = ipInfo.country;

    const locParts = [ipInfo.city, ipInfo.region, ipInfo.country].filter(Boolean);
    if (locationValueEl) locationValueEl.textContent = locParts.join(", ") || "Location unlinked";
    if (ispPill) ispPill.textContent = ipInfo.isp || "Unknown Provider";

    // Step 1: Ping / Jitter
    if (statusText) statusText.textContent = "Analyzing structural latency…";
    const { ping, jitter } = await measurePingAndJitter();
    lastResults.ping = ping;
    lastResults.jitter = jitter;

    if (pingValueEl) pingValueEl.textContent = ping.toFixed(1);
    if (jitterValueEl) jitterValueEl.textContent = jitter.toFixed(1);
    if (pingResultEl) pingResultEl.textContent = ping.toFixed(1);
    if (jitterResultEl) jitterResultEl.textContent = jitter.toFixed(1);

    // Step 2: Download Stream Pipeline
    if (statusText) statusText.textContent = "Streaming downstream channels…";
    const down = await measureDownload();
    lastResults.download = down;
    if (downResultEl) downResultEl.textContent = down.toFixed(2);
    animateSpeed(down, "Download Finished");
    updateGauge(down);

    // Step 3: Upload Stream Pipeline
    if (statusText) statusText.textContent = "Saturating upload pipelines…";
    const up = await measureUpload();
    lastResults.upload = up;
    if (upResultEl) upResultEl.textContent = up.toFixed(2);
    animateSpeed(up, "Upload Finished");
    updateGauge(up);

    // Diagnostics Evaluations
    const ispGuess = guessISP(ipInfo, down, up, ping);
    lastResults.isp = ispGuess;
    if (ispPill) ispPill.textContent = ispGuess;

    const { pros, cons } = analyzeNetwork(down, up, ping, jitter);
    renderProsCons(pros, cons);

    if (statusText) statusText.textContent = "Test run successfully compiled.";
  } catch (e) {
    console.error(e);
    if (errorText) errorText.textContent = "High-speed stream pipeline disrupted. Check for local firewalls or active socket blockers.";
    if (statusText) statusText.textContent = "Execution Halted.";
  }

  startBtn.classList.remove("disabled");
}

// --- Initial Execution Entry ---
if (startBtn) startBtn.addEventListener("click", runTest);
initTheme();
if (statusText) statusText.textContent = "Systems ready for diagnostic run.";

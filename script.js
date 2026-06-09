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

const GAUGE_MAX_MBPS = 500;
const GAUGE_LENGTH = 503;

const CF_PING = "https://speed.cloudflare.com/__down?bytes=1";
const CF_DOWN = "https://speed.cloudflare.com/__down?bytes=";
const CF_UP = "https://nokira-api.live-by-unix.workers.dev/";
const IP_INFO = "https://ipapi.co/json/";

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

function initTheme() {
  const saved = localStorage.getItem("nokira-theme");
  const theme = saved === "light" ? "light" : "dark";
  document.body.setAttribute("data-theme", theme);
  themeSwitch.checked = theme === "light";
}

themeSwitch.addEventListener("change", () => {
  const theme = themeSwitch.checked ? "light" : "dark";
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem("nokira-theme", theme);
});

function animateSpeed(target, label) {
  const start = lastSpeedDisplay;
  const end = target;
  const duration = 200;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const value = start + (end - start) * eased;
    speedValueEl.textContent = value.toFixed(2);
    if (t < 1) requestAnimationFrame(step);
    else lastSpeedDisplay = end;
  }

  speedLabelEl.textContent = label;
  requestAnimationFrame(step);
}

function updateGauge(mbps) {
  const clamped = Math.max(0, Math.min(GAUGE_MAX_MBPS, mbps));
  const ratio = clamped / GAUGE_MAX_MBPS;
  gaugeArc.style.strokeDashoffset = (GAUGE_LENGTH - GAUGE_LENGTH * ratio).toString();
}

async function measurePingAndJitter(iter = 20) {
  const times = [];

  for (let i = 0; i < iter; i++) {
    const start = performance.now();
    try {
      await fetch(CF_PING, { cache: "no-store", mode: "cors" });
      times.push(performance.now() - start);
    } catch {
      times.push(250);
    }
    await new Promise((r) => setTimeout(r, 15));
  }

  times.sort((a, b) => a - b);
  const cut = Math.floor(times.length * 0.1);
  const trimmed = times.slice(cut, times.length - cut);

  const avg = trimmed.reduce((a, b) => a + b, 0) / Math.max(trimmed.length, 1);
  const jitter = trimmed.reduce((acc, t) => acc + Math.abs(t - avg), 0) / Math.max(trimmed.length, 1);

  return { ping: avg, jitter };
}

async function measureDownload() {
  const targetSeconds = 8;
  const numStreams = 4;
  let totalBytesDownloaded = 0;
  const start = performance.now();
  const controller = new AbortController();

  const downloadStream = async () => {
    const chunkUrl = CF_DOWN + "50000000";
    try {
      const response = await fetch(chunkUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytesDownloaded += value.length;

        const elapsed = (performance.now() - start) / 1000;
        if (elapsed >= targetSeconds) {
          controller.abort();
          break;
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") console.warn(e);
    }
  };

  const uiInterval = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed > 0.5) {
      const mbps = (totalBytesDownloaded * 8) / elapsed / 1_000_000;
      animateSpeed(mbps, "Download…");
      updateGauge(mbps);
    }
  }, 150);

  await Promise.all(Array.from({ length: numStreams }, downloadStream));
  clearInterval(uiInterval);

  const totalSeconds = (performance.now() - start) / 1000;
  return (totalBytesDownloaded * 8) / totalSeconds / 1_000_000;
}

async function measureUpload() {
  const targetSeconds = 8;
  const chunkSize = 2_000_000;
  const payload = new Uint8Array(chunkSize);
  const maxConcurrentUploads = 3;

  let totalBytesUploaded = 0;
  const start = performance.now();
  let activeWorkers = 0;

  const uploadWorker = async () => {
    if ((performance.now() - start) / 1000 >= targetSeconds) return;
    activeWorkers++;

    try {
      await fetch(CF_UP, {
        method: "POST",
        body: payload,
        mode: "cors"
      });
      totalBytesUploaded += chunkSize;
    } catch (e) {
      console.warn(e);
    }

    activeWorkers--;
    if ((performance.now() - start) / 1000 < targetSeconds) {
      await uploadWorker();
    }
  };

  const uiInterval = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed > 0.5) {
      const mbps = (totalBytesUploaded * 8) / elapsed / 1_000_000;
      animateSpeed(mbps, "Upload…");
      updateGauge(mbps);
    }
  }, 150);

  const workers = [];
  for (let i = 0; i < maxConcurrentUploads; i++) {
    workers.push(uploadWorker());
  }
  
  await Promise.all(workers);
  
  while(activeWorkers > 0) {
     await new Promise(r => setTimeout(r, 50));
  }
  
  clearInterval(uiInterval);

  const totalSeconds = (performance.now() - start) / 1000;
  return (totalBytesUploaded * 8) / totalSeconds / 1_000_000;
}

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
    return {
      ip: null,
      isp: "Unknown",
      city: null,
      region: null,
      country: null,
    };
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

  if (symmetric && down > 300) return "Likely Fiber Provider";
  if (!symmetric && down > 50 && up < 40) return "Likely Cable Provider";
  if (ping > 60 && down < 50) return "Possibly LTE/5G";

  return info.isp;
}

function analyzeNetwork(down, up, ping, jitter) {
  const pros = [];
  const cons = [];

  if (down >= 500) pros.push("Excellent for 4K streaming and cloud gaming.");
  else if (down >= 200) pros.push("Great for HD/4K streaming and multitasking.");
  else if (down >= 50) pros.push("Good for HD streaming and browsing.");
  else cons.push("Download speed is low for modern streaming.");

  if (up >= 100) pros.push("Fantastic upload for streaming and backups.");
  else if (up >= 20) pros.push("Strong upload for video calls.");
  else if (up >= 5) pros.push("Upload is fine for casual calls.");
  else cons.push("Upload may cause issues with video calls.");

  if (ping <= 20) pros.push("Excellent latency for gaming.");
  else if (ping <= 40) pros.push("Good latency for most apps.");
  else if (ping <= 70) cons.push("Latency may be noticeable in games.");
  else cons.push("High latency affects real‑time apps.");

  if (jitter <= 10) pros.push("Stable connection for calls.");
  else if (jitter <= 25) cons.push("Some jitter may cause glitches.");
  else cons.push("High jitter suggests instability.");

  return {
    pros: [...new Set(pros)],
    cons: [...new Set(cons)],
  };
}

function renderProsCons(pros, cons) {
  prosListEl.innerHTML = "";
  consListEl.innerHTML = "";

  pros.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p;
    prosListEl.appendChild(li);
  });

  cons.forEach((c) => {
    const li = document.createElement("li");
    li.textContent = c;
    consListEl.appendChild(li);
  });
}

function generateShareText() {
  const r = lastResults;

  const prosItems = Array.from(prosListEl.children).map((li) => li.textContent);
  const consItems = Array.from(consListEl.children).map((li) => li.textContent);

  return (
    "📡 Nokira Internet Speed Test Results\n" +
    "-----------------------------------\n" +
    (r.ip ? `IP: ${r.ip}\n` : "") +
    (r.city || r.region || r.country
      ? `Location: ${[r.city, r.region, r.country].filter(Boolean).join(", ")}\n`
      : "") +
    `Download: ${r.download?.toFixed(2) ?? "--"} Mbps\n` +
    `Upload:   ${r.upload?.toFixed(2) ?? "--"} Mbps\n` +
    `Ping:      ${r.ping?.toFixed(1) ?? "--"} ms\n` +
    `Jitter:   ${r.jitter?.toFixed(1) ?? "--"} ms\n` +
    `ISP:       ${r.isp}\n\n` +
    "Pros:\n" +
    prosItems.map((p) => "- " + p).join("\n") +
    "\n\nCons:\n" +
    consItems.map((c) => "- " + c).join("\n") +
    "\n\nTested with Nokira Internet Speed Test."
  );
}

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(generateShareText());
    statusText.innerHTML = "<strong>Copied!</strong>";
  } catch {
    statusText.textContent = "Copy failed.";
  }
});

emailBtn.addEventListener("click", () => {
  const subject = encodeURIComponent("My Nokira Internet Speed Test Results");
  const body = encodeURIComponent(generateShareText());
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
});

async function runTest() {
  if (startBtn.classList.contains("disabled")) return;

  startBtn.classList.add("disabled");
  errorText.textContent = "";

  animateSpeed(0, "Preparing…");
  updateGauge(0);
  statusText.textContent = "Preparing test…";

  try {
    const ipInfo = await fetchIPInfo();
    lastResults.ip = ipInfo.ip;
    lastResults.city = ipInfo.city;
    lastResults.region = ipInfo.region;
    lastResults.country = ipInfo.country;

    const locParts = [ipInfo.city, ipInfo.region, ipInfo.country].filter(Boolean);
    locationValueEl.textContent = locParts.join(", ") || "Location unavailable";

    ispPill.textContent = ipInfo.isp || "Unknown ISP";

    statusText.textContent = "Measuring ping…";
    const { ping, jitter } = await measurePingAndJitter();
    lastResults.ping = ping;
    lastResults.jitter = jitter;

    pingValueEl.textContent = ping.toFixed(1);
    jitterValueEl.textContent = jitter.toFixed(1);
    pingResultEl.textContent = ping.toFixed(1);
    jitterResultEl.textContent = jitter.toFixed(1);

    statusText.textContent = "Measuring download…";
    const down = await measureDownload();
    lastResults.download = down;
    downResultEl.textContent = down.toFixed(2);
    animateSpeed(down, "Download");
    updateGauge(down);

    statusText.textContent = "Measuring upload…";
    const up = await measureUpload();
    lastResults.upload = up;
    upResultEl.textContent = up.toFixed(2);
    animateSpeed(up, "Upload");
    updateGauge(up);

    const ispGuess = guessISP(ipInfo, down, up, ping);
    lastResults.isp = ispGuess;
    ispPill.textContent = ispGuess;

    const { pros, cons } = analyzeNetwork(down, up, ping, jitter);
    renderProsCons(pros, cons);

    statusText.textContent = "Done.";
  } catch (e) {
    console.error(e);
    errorText.textContent = "Test failed. Your network or browser may block speed test traffic.";
    statusText.textContent = "Error.";
  }

  startBtn.classList.remove("disabled");
}

startBtn.addEventListener("click", runTest);
initTheme();
statusText.textContent = "Ready when you are.";

/* ELEMENTS */
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

/* CONSTANTS */
const GAUGE_MAX_MBPS = 500;
const GAUGE_LENGTH = 503;

/* Endpoints */
const CF_PING = "https://speed.cloudflare.com/__down?bytes=1";
const CF_DOWN = "https://speed.cloudflare.com/__down?bytes=";

// YOUR WORKER URL (upload proxy)
const CF_UP = "https://nokira-api.live-by-unix.workers.dev/";

const IP_INFO = "https://ipapi.co/json/";

/* STATE */
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

/* ---------------------------------------------------------
   THEME
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   GAUGE
--------------------------------------------------------- */
function animateSpeed(target, label) {
    const start = lastSpeedDisplay;
    const end = target;
    const duration = 500;
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

/* ---------------------------------------------------------
   PING + JITTER
--------------------------------------------------------- */
async function measurePingAndJitter(iter = 10) {
    const times = [];

    for (let i = 0; i < iter; i++) {
        const start = performance.now();
        try {
            await fetch(CF_PING, { cache: "no-store" });
            times.push(performance.now() - start);
        } catch {
            times.push(200);
        }
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const jitter =
        Math.sqrt(
            times
                .map((t) => Math.pow(t - avg, 2))
                .reduce((a, b) => a + b, 0) / times.length
        );

    return { ping: avg, jitter };
}

/* ---------------------------------------------------------
   DOWNLOAD
--------------------------------------------------------- */
async function measureDownload() {
    let size = 20_000_000;
    let bytes = 0;
    const start = performance.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(CF_DOWN + size, {
            cache: "no-store",
            signal: controller.signal,
        });

        const reader = response.body.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bytes += value.length;
            const elapsed = (performance.now() - start) / 1000;

            if (elapsed > 0.4) {
                const mbps = (bytes * 8) / elapsed / 1_000_000;
                animateSpeed(mbps, "Download…");
                updateGauge(mbps);
            }
        }
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }

    clearTimeout(timeout);

    const totalSeconds = (performance.now() - start) / 1000;
    return (bytes * 8) / totalSeconds / 1_000_000;
}

/* ---------------------------------------------------------
   UPLOAD (NO STREAMING IN BROWSER — STREAMS IN WORKER)
--------------------------------------------------------- */
async function measureUpload() {
    const sizeBytes = 4_000_000;
    const payload = new Uint8Array(sizeBytes);
    crypto.getRandomValues(payload);

    const start = performance.now();

    // Browser sends a normal Uint8Array → Worker streams it upstream
    await fetch(CF_UP, {
        method: "POST",
        body: payload,
    });

    const totalSeconds = (performance.now() - start) / 1000;
    return (sizeBytes * 8) / totalSeconds / 1_000_000;
}

/* ---------------------------------------------------------
   IP + ISP
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   ISP GUESS
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   PROS / CONS
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   SHARE
--------------------------------------------------------- */
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
        `Ping:     ${r.ping?.toFixed(1) ?? "--"} ms\n` +
        `Jitter:   ${r.jitter?.toFixed(1) ?? "--"} ms\n` +
        `ISP:      ${r.isp}\n\n` +
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

/* ---------------------------------------------------------
   MAIN TEST
--------------------------------------------------------- */
async function runTest() {
    if (startBtn.classList.contains("disabled")) return;

    startBtn.classList.add("disabled");
    errorText.textContent = "";
    resultsPanel.classList.remove("visible");

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

        const ispGuess = guessISP(ipInfo, down, up, ping);
        lastResults.isp = ispGuess;
        ispPill.textContent = ispGuess;

        const { pros, cons } = analyzeNetwork(down, up, ping, jitter);
        renderProsCons(pros, cons);

        resultsPanel.classList.add("visible");
        statusText.textContent = "Done.";
    } catch (e) {
        console.error(e);
        errorText.textContent = "Test failed. Your network or browser may block speed test traffic.";
        statusText.textContent = "Error.";
    }

    startBtn.classList.remove("disabled");
}

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
startBtn.addEventListener("click", runTest);
initTheme();
statusText.textContent = "Ready when you are.";

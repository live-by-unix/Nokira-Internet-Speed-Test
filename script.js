/* ---------------------------------------------------------
   Nokira Internet Speed Test — script.js
   Cloudflare Ping + Download + Streaming Upload
   Full Gauge Animation + ISP Detection + Pros/Cons
--------------------------------------------------------- */

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
const GAUGE_LENGTH = 503; // circumference of r=80 circle

/* Cloudflare Endpoints */
const CLOUDFLARE_PING_URL = "https://speed.cloudflare.com/__down?bytes=1";
const CLOUDFLARE_DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=20000000";
const CLOUDFLARE_UPLOAD_URL = "https://speed.cloudflare.com/__up";
const IP_INFO_URL = "https://ipapi.co/json/"; // no token required

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
   GAUGE ANIMATION
--------------------------------------------------------- */
function animateSpeed(target, label) {
    const start = lastSpeedDisplay;
    const end = target;
    const duration = 600;
    const startTime = performance.now();

    function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = start + (end - start) * eased;
        speedValueEl.textContent = value.toFixed(2);
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            lastSpeedDisplay = end;
        }
    }
    speedLabelEl.textContent = label;
    requestAnimationFrame(step);
}

function updateGauge(mbps) {
    const clamped = Math.max(0, Math.min(GAUGE_MAX_MBPS, mbps));
    const ratio = clamped / GAUGE_MAX_MBPS;
    const offset = GAUGE_LENGTH - GAUGE_LENGTH * ratio;
    gaugeArc.style.strokeDashoffset = offset.toString();
}

/* ---------------------------------------------------------
   PING + JITTER (Cloudflare)
--------------------------------------------------------- */
async function measurePingAndJitter(iterations = 8) {
    const times = [];

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        try {
            await fetch(CLOUDFLARE_PING_URL, { cache: "no-store" });
            const end = performance.now();
            times.push(end - start);
        } catch {
            times.push(200);
        }
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const jitter =
        times.length > 1
            ? Math.sqrt(
                  times
                      .map((t) => Math.pow(t - avg, 2))
                      .reduce((a, b) => a + b, 0) /
                      (times.length - 1)
              )
            : 0;

    return { ping: avg, jitter };
}

/* ---------------------------------------------------------
   DOWNLOAD TEST (Cloudflare)
--------------------------------------------------------- */
async function measureDownload() {
    const startTime = performance.now();
    let bytes = 0;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(CLOUDFLARE_DOWNLOAD_URL, {
            cache: "no-store",
            signal: controller.signal,
        });

        const reader = response.body.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bytes += value.length;
            const elapsed = (performance.now() - startTime) / 1000;

            if (elapsed > 0.5) {
                const mbps = (bytes * 8) / elapsed / 1_000_000;
                animateSpeed(mbps, "Measuring download…");
                updateGauge(mbps);
            }
        }
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }

    clearTimeout(timeout);

    const totalSeconds = (performance.now() - startTime) / 1000;
    return (bytes * 8) / totalSeconds / 1_000_000;
}

/* ---------------------------------------------------------
   UPLOAD TEST (Cloudflare STREAMING upload)
--------------------------------------------------------- */
async function measureUpload() {
    const sizeBytes = 4_000_000;
    const chunk = new Uint8Array(65536);
    crypto.getRandomValues(chunk);

    const startTime = performance.now();

    const stream = new ReadableStream({
        start(controller) {
            let sent = 0;
            function push() {
                if (sent >= sizeBytes) {
                    controller.close();
                    return;
                }
                controller.enqueue(chunk);
                sent += chunk.length;
                push();
            }
            push();
        },
    });

    try {
        await fetch(CLOUDFLARE_UPLOAD_URL, {
            method: "POST",
            body: stream,
        });
    } catch (e) {
        throw e;
    }

    const totalSeconds = (performance.now() - startTime) / 1000;
    return (sizeBytes * 8) / totalSeconds / 1_000_000;
}

/* ---------------------------------------------------------
   IP + ISP INFO
--------------------------------------------------------- */
async function fetchIPInfo() {
    try {
        const res = await fetch(IP_INFO_URL, { cache: "no-store" });
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
   ISP GUESSING ENGINE
--------------------------------------------------------- */
function guessISP(ipInfo, down, up, ping) {
    const ispRaw = ipInfo.isp || "Unknown";
    const ispLower = ispRaw.toLowerCase();
    const symmetric = Math.abs(down - up) / Math.max(down, 1) < 0.25;

    if (ispLower.includes("google")) return "Likely Google Fiber";
    if (ispLower.includes("comcast") || ispLower.includes("xfinity")) return "Likely Xfinity";
    if (ispLower.includes("spectrum") || ispLower.includes("charter")) return "Likely Spectrum";
    if (ispLower.includes("verizon")) return symmetric ? "Likely Verizon Fios" : "Likely Verizon";
    if (ispLower.includes("at&t") || ispLower.includes("att")) return symmetric ? "Likely AT&T Fiber" : "Likely AT&T";
    if (ispLower.includes("cox")) return "Likely Cox";
    if (ispLower.includes("rogers")) return "Likely Rogers";
    if (ispLower.includes("bell")) return "Likely Bell";
    if (ispLower.includes("telus")) return "Likely Telus";
    if (ispLower.includes("virgin")) return "Likely Virgin Media";

    if (symmetric && down > 300) return "Likely fiber provider";
    if (!symmetric && down > 50 && up < 40) return "Likely cable provider";
    if (ping > 60 && down < 50) return "Possibly LTE/5G";

    return ispRaw;
}

/* ---------------------------------------------------------
   PROS / CONS ENGINE
--------------------------------------------------------- */
function analyzeNetwork(down, up, ping, jitter) {
    const pros = [];
    const cons = [];

    if (down >= 500) {
        pros.push("Excellent for 4K streaming, cloud gaming, and heavy downloads.");
        pros.push("Plenty of headroom for multiple users.");
    } else if (down >= 200) {
        pros.push("Great for HD/4K streaming and most tasks.");
    } else if (down >= 50) {
        pros.push("Good for HD streaming and browsing.");
    } else {
        cons.push("Download speed is low for modern streaming.");
    }

    if (up >= 100) pros.push("Fantastic upload for streaming and backups.");
    else if (up >= 20) pros.push("Strong upload for video calls.");
    else if (up >= 5) pros.push("Upload is fine for casual calls.");
    else cons.push("Upload may cause issues with video calls.");

    if (ping <= 20) pros.push("Excellent latency for gaming.");
    else if (ping <= 40) pros.push("Good latency for most apps.");
    else if (ping <= 70) cons.push("Latency may be noticeable in games.");
    else cons.push("High latency affects real-time apps.");

    if (jitter <= 10) pros.push("Stable connection for calls.");
    else if (jitter <= 25) cons.push("Some jitter may cause glitches.");
    else cons.push("High jitter suggests instability.");

    const symmetric = Math.abs(down - up) / Math.max(down, 1) < 0.25;
    if (symmetric && down > 100) pros.push("Symmetric speeds suggest fiber.");
    else if (!symmetric && up < down / 5) cons.push("Asymmetric speeds indicate upload bottleneck.");

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
   SHARE TEXT
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
   MAIN TEST RUNNER
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
        /* IP + ISP */
        const ipInfo = await fetchIPInfo();
        lastResults.ip = ipInfo.ip;
        lastResults.city = ipInfo.city;
        lastResults.region = ipInfo.region;
        lastResults.country = ipInfo.country;

        const locParts = [ipInfo.city, ipInfo.region, ipInfo.country].filter(Boolean);
        locationValueEl.textContent = locParts.join(", ") || "Location unavailable";

        ispPill.textContent = ipInfo.isp || "Unknown ISP";

        /* PING + JITTER */
        statusText.textContent = "Measuring ping…";
        const { ping, jitter } = await measurePingAndJitter();
        lastResults.ping = ping;
        lastResults.jitter = jitter;

        pingValueEl.textContent = ping.toFixed(1);
        jitterValueEl.textContent = jitter.toFixed(1);
        pingResultEl.textContent = ping.toFixed(1);
        jitterResultEl.textContent = jitter.toFixed(1);

        /* DOWNLOAD */
        statusText.textContent = "Measuring download…";
        const down = await measureDownload();
        lastResults.download = down;
        downResultEl.textContent = down.toFixed(2);
        animateSpeed(down, "Download");
        updateGauge(down);

        /* UPLOAD */
        statusText.textContent = "Measuring upload…";
        const up = await measureUpload();
        lastResults.upload = up;
        upResultEl.textContent = up.toFixed(2);

        /* ISP GUESS */
        const ispGuess = guessISP(ipInfo, down, up, ping);
        lastResults.isp = ispGuess;
        ispPill.textContent = ispGuess;

        /* PROS / CONS */
        const { pros, cons } = analyzeNetwork(down, up, ping, jitter);
        renderProsCons(pros, cons);

        /* SHOW RESULTS */
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

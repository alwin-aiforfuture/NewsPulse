async function fetchSeries({ coin, date }) {
  const url = `/api/series?coins=${encodeURIComponent(coin)}&date=${encodeURIComponent(date)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatDate(ms) {
  // Convert to UTC+8
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function formatTimeAMPM(ms) {
  // Convert to UTC+8
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  h = h ? h : 12;
  const mm = String(m).padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
}

function buildDataset(coin, points, color) {
  return {
    label: coin,
    data: points.map((p) => ({ x: p.t, y: p.price })),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    tension: 0,
    fill: false,
  };
}

function pickColor(i) {
  const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"];
  return colors[i % colors.length];
}

function todayYYYYMMDD() {
  // Get current date in UTC+8
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = utc8.getUTCFullYear();
  const m = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc8.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDefaultDate() {
  const dateEl = document.getElementById("date");
  if (!dateEl.value) dateEl.value = todayYYYYMMDD();
}

let loadingDotsInterval = null;

function startLoadingAnimation(textElement, baseText) {
  if (loadingDotsInterval) clearInterval(loadingDotsInterval);
  let dots = 0;
  loadingDotsInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    textElement.textContent = baseText + '.'.repeat(dots);
  }, 500);
}

function stopLoadingAnimation() {
  if (loadingDotsInterval) {
    clearInterval(loadingDotsInterval);
    loadingDotsInterval = null;
  }
}

async function fetchNewsPoints({ coin, date }) {
  try {
    const res = await fetch(`/api/news_points?coin=${encodeURIComponent(coin)}&date=${encodeURIComponent(date)}`);
    if (res.ok) {
      const data = await res.json();
      return { points: data.points || [], window: data.window || "" };
    }
  } catch (e) {
    console.error("Failed to fetch news points:", e);
  }
  return { points: [], window: "" };
}

async function render() {
  ensureDefaultDate();
  const coinInput = document.getElementById("coin").value.trim().toUpperCase();
  const dateInput = document.getElementById("date").value;
  const meta = document.getElementById("meta");
  const overlay = document.getElementById("newsLoading");
  
  // Clear chart and news before fetching
  if (window.__chart) {
    // Clean up event listeners
    const canvas = window.__chart.canvas;
    if (canvas) {
      canvas.removeEventListener('mousemove', window.__chart._onMove);
      canvas.removeEventListener('mouseleave', window.__chart._onLeave);
    }
    window.removeEventListener('resize', window.__chart._onResize);
    window.__chart.destroy();
    window.__chart = null;
  }
  document.getElementById("news-list").innerHTML = "";
  const legendElPre = document.getElementById("legend");
  if (legendElPre) legendElPre.innerHTML = "";
  
  // Show loading overlay
  const loadingText = document.getElementById("loadingText");
  const loadBtn = document.getElementById("loadBtn");
  if (overlay) {
    if (loadingText) {
      startLoadingAnimation(loadingText, "Loading all data");
    }
    overlay.classList.remove("hidden");
  }
  if (loadBtn) loadBtn.classList.add("loading");
  meta.textContent = "Loading...";
  
  try {
    // Fetch both price data and news data in parallel
    const [seriesData, newsData] = await Promise.all([
      fetchSeries({ coin: coinInput, date: dateInput }),
      fetchNewsPoints({ coin: coinInput, date: dateInput })
    ]);
    const newsPoints = newsData.points;
    const newsWindow = newsData.window;
    
    // Hide loading overlay
    stopLoadingAnimation();
    if (overlay) overlay.classList.add("hidden");
    if (loadBtn) loadBtn.classList.remove("loading");
    
    const ctx = document.getElementById("chart");
    const datasets = [];
    const s = seriesData.series.find((it) => it.coin === coinInput) || seriesData.series[0];
    if (s && !s.error && s.points && s.points.length) {
      datasets.push(buildDataset(s.coin, s.points, pickColor(0)));
    }
    const newsOverlayPlugin = {
      id: "newsOverlay",
      afterDatasetsDraw(chart) {
        const data = chart.$newsOverlayData;
        if (!data || !data.length) return;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        ctx.save();
        const pixels = [];
        data.forEach((d) => {
          const x = xScale.getPixelForValue(d.x);
          const y = yScale.getPixelForValue(d.y);
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          const isPrice = !!(d && d._meta && d._meta.isPriceNews);
          const snt = d && d._meta && d._meta.sentiment;
  
            if (snt === "bullish") {
              ctx.fillStyle = "#00e676"; // vivid green
              ctx.strokeStyle = "#00c853";
  
            } else if (snt === "neutral") {
              ctx.fillStyle = "#ffd400"; // vivid yellow
              ctx.strokeStyle = "#ffab00";
            } else {
              ctx.fillStyle = "#ff1744"; // vivid red
              ctx.strokeStyle = "#d50000";
            }
              if (isPrice)  {
                ctx.globalAlpha = 0.5; // Set alpha for price-only news
              }
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
          // Draw confidence percentage above the dot
          const meta = d && d._meta ? d._meta : null;
          const confPct = meta && typeof meta.confidence === 'number' ? Math.round(meta.confidence * 100) : null;
          if (confPct !== null) {
            const label = confPct + "%";
            const chartArea = chart.chartArea;
            let labelX = x;
            let labelY = y - 8;
            // If too close to top, place below the dot
            if (labelY < chartArea.top + 6) labelY = y + 12;
            ctx.font = "10px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            // Outline for readability
            ctx.strokeStyle = "rgba(19, 24, 41, 0.8)";
            ctx.lineWidth = 3;
            ctx.strokeText(label, labelX, labelY);
            // Fill text
            ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            ctx.fillText(label, labelX, labelY);
          }
          // Reset alpha for subsequent draws
          ctx.globalAlpha = 1.0;
          pixels.push({ x, y, d });
        });
        ctx.restore();
        chart.$newsOverlayPixels = pixels;
      },
    };

    const crosshairPlugin = {
      id: "crosshair",
      afterDatasetsDraw(chart) {
        if (!chart.$crosshairPosition) return;
        
        const { x, y, isMagnetized } = chart.$crosshairPosition;
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        
        ctx.save();
        
        // Use brighter color and solid line when magnetized to news dot
        if (isMagnetized) {
          ctx.strokeStyle = "rgba(102, 126, 234, 0.6)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]); // Solid line when magnetized
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]); // Dashed line normally
        }
        
        // Draw vertical line
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        
        // Draw horizontal line
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        
        // Get price and time values at crosshair position
        const timeValue = xScale.getValueForPixel(x);
        const priceValue = yScale.getValueForPixel(y);
        
        // Get actual price at intersection point (where vertical line crosses the price line)
        let intersectionPrice = null;
        if (typeof timeValue === "number" && chart.data.datasets.length > 0) {
          const dataset = chart.data.datasets[0];
          if (dataset.data && dataset.data.length > 0) {
            // Find the price at this time point
            const dataPoints = dataset.data;
            // Binary search or linear search to find closest point
            let closestPoint = null;
            let minDiff = Infinity;
            
            for (const point of dataPoints) {
              if (point && typeof point.x === "number") {
                const diff = Math.abs(point.x - timeValue);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestPoint = point;
                }
              }
            }
            
            // If we found a close point, use its price
            // Otherwise interpolate between points
            if (closestPoint && minDiff < 3600000) { // Within 1 hour
              intersectionPrice = closestPoint.y;
            } else if (dataPoints.length > 1) {
              // Interpolate between two closest points
              const sortedPoints = [...dataPoints]
                .filter(p => p && typeof p.x === "number")
                .sort((a, b) => a.x - b.x);
              
              for (let i = 0; i < sortedPoints.length - 1; i++) {
                const p1 = sortedPoints[i];
                const p2 = sortedPoints[i + 1];
                
                if (timeValue >= p1.x && timeValue <= p2.x) {
                  // Linear interpolation
                  const ratio = (timeValue - p1.x) / (p2.x - p1.x);
                  intersectionPrice = p1.y + ratio * (p2.y - p1.y);
                  break;
                }
              }
              
              // If time is before first point or after last point
              if (intersectionPrice === null && sortedPoints.length > 0) {
                if (timeValue < sortedPoints[0].x) {
                  intersectionPrice = sortedPoints[0].y;
                } else if (timeValue > sortedPoints[sortedPoints.length - 1].x) {
                  intersectionPrice = sortedPoints[sortedPoints.length - 1].y;
                }
              }
            }
          }
        }
        
        // Format time
        const timeStr = typeof timeValue === "number" ? formatTimeAMPM(timeValue) : "";
        
        // Format price (round to 2 decimal places)
        const priceStr = typeof priceValue === "number" ? priceValue.toFixed(2) : "";
        const intersectionPriceStr = intersectionPrice !== null ? intersectionPrice.toFixed(2) : "";
        
        // Draw intersection price label on left side (Y-axis area)
        if (intersectionPriceStr) {
          const intersectionY = yScale.getPixelForValue(intersectionPrice);
          
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.font = "bold 12px 'Inter', sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          
          // Background for intersection price label
          const priceTextWidth = ctx.measureText(intersectionPriceStr).width;
          const labelPadding = 6;
          const labelX = chartArea.left - 8;
          const labelY = intersectionY;
          
          ctx.fillStyle = "rgba(102, 126, 234, 0.95)";
          ctx.fillRect(
            labelX - priceTextWidth - labelPadding * 2,
            labelY - 12,
            priceTextWidth + labelPadding * 2,
            24
          );
          
          ctx.fillStyle = "rgba(255, 255, 255, 1)";
          ctx.fillText(intersectionPriceStr, labelX - labelPadding, labelY);
        }
        
        // Draw cursor Y position price label on left side (Y-axis area) - secondary/lighter
        if (priceStr) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          ctx.font = "12px 'Inter', sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          
          // Background for price label (lighter, secondary)
          const priceTextWidth = ctx.measureText(priceStr).width;
          const labelPadding = 6;
          const labelX = chartArea.left - 8;
          const labelY = y;
          
          ctx.fillStyle = "rgba(19, 24, 41, 0.8)";
          ctx.fillRect(
            labelX - priceTextWidth - labelPadding * 2,
            labelY - 12,
            priceTextWidth + labelPadding * 2,
            24
          );
          
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          ctx.fillText(priceStr, labelX - labelPadding, labelY);
        }
        
        // Draw time label on bottom (X-axis area)
        if (timeStr) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.font = "12px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          
          // Background for time label
          const timeTextWidth = ctx.measureText(timeStr).width;
          const labelPadding = 6;
          const labelX = x;
          const labelY = chartArea.bottom + 8;
          
          ctx.fillStyle = "rgba(19, 24, 41, 0.95)";
          ctx.fillRect(
            labelX - timeTextWidth / 2 - labelPadding,
            labelY,
            timeTextWidth + labelPadding * 2,
            20
          );
          
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fillText(timeStr, labelX, labelY + 4);
        }
        
        ctx.restore();
      },
    };

    const config = {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: {
            type: "time",
            time: { unit: "hour" },
            adapters: { date: { zone: 'Asia/Shanghai' } },
            ticks: {
              callback: (val) => {
                const ts = typeof val === "number" ? val : Number(val);
                return formatTimeAMPM(ts);
              },
            },
          },
          y: { beginAtZero: false },
        },
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: `Date: ${dateInput}${newsWindow ? ` • Timeframe: ${newsWindow}` : ""}` },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = ctx.raw;
                if (d && d._meta) {
                  const tDate = formatDate(d._meta.t);
                  const tTime = formatTimeAMPM(d._meta.t);
                  const sent = d._meta.sentiment ? ` (${d._meta.sentiment})` : "";
                  return `News @ ${tDate} ${tTime}${sent}: ${d._meta.title}`;
                }
                return `${ctx.dataset.label}: ${ctx.parsed.y}`;
              },
              afterBody: (items) => {
                const d = items && items[0] && items[0].raw;
                if (d && d._meta) {
                  const src = d._meta.source ? `Source: ${d._meta.source}` : "";
                  const conf = typeof d._meta.confidence === "number" ? `Confidence: ${Math.round(d._meta.confidence*100)}%` : "";
                  const reason = d._meta.reason ? `Reason: ${d._meta.reason}` : "";
                  return [src, conf, reason].filter(Boolean).join("\n");
                }
                return '';
              },
              footer: (items) => {
                return '';
              }
            },
          },
        },
      },
      plugins: [newsOverlayPlugin, crosshairPlugin],
    };
    // Prepare news overlay data before creating chart
    let overlayData = [];
    if (s && s.points && s.points.length && newsPoints.length) {
      const series = (s.points || []).slice().sort((a,b)=>a.t-b.t);
      const priceAt = (ts) => {
        if (!series.length) return null;
        if (ts <= series[0].t) return series[0].price;
        if (ts >= series[series.length-1].t) return series[series.length-1].price;
        // binary search to find bracketing points
        let lo = 0, hi = series.length - 1;
        while (lo + 1 < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (series[mid].t === ts) return series[mid].price;
          if (series[mid].t < ts) lo = mid; else hi = mid;
        }
        const p0 = series[lo];
        const p1 = series[hi];
        const span = p1.t - p0.t;
        if (span <= 0) return p0.price;
        const frac = (ts - p0.t) / span;
        return p0.price + frac * (p1.price - p0.price);
      };
      overlayData = newsPoints.map((pt) => ({ x: pt.t, y: priceAt(pt.t), _meta: pt }));
    }
    
    // Set news overlay data before creating chart
    config.data.newsOverlayData = overlayData;
    
    // destroy previous chart if any
    if (window.__chart) window.__chart.destroy();
    
    // Ensure canvas uses full width
    ctx.style.width = '100%';
    ctx.style.height = '100%';
    ctx.style.maxWidth = '100%';
    
    window.__chart = new Chart(ctx, config);
    
    // Set news overlay data on chart instance
    window.__chart.$newsOverlayData = overlayData;
    // Store timeframe for tooltip display
    window.__chart.$newsWindow = newsWindow;
    window.__chart.update();

    // Setup hover tooltip for overlay points
    const ensureTooltipEl = () => {
      const wrap = document.querySelector('.chart-wrap');
      let tip = wrap.querySelector('#newsTooltip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'newsTooltip';
        tip.className = 'news-tooltip hidden';
        wrap.appendChild(tip);
      }
      return tip;
    };
    const tipEl = ensureTooltipEl();
    let lastHoveredPoint = null;
    let rafId = null;
    let rectCache = null;
    
    // Ensure tooltip is hidden initially
    tipEl.classList.add('hidden');
    
    // Cache bounding rect and invalidate on resize
    const getCachedRect = () => {
      if (!rectCache) {
        rectCache = canvas.getBoundingClientRect();
      }
      return rectCache;
    };
    
    const invalidateRectCache = () => {
      rectCache = null;
    };
    
    // Use squared distance for faster comparison (avoid Math.sqrt)
    const getSquaredDistance = (x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return dx * dx + dy * dy;
    };
    
    const showTip = (chart, item, x, y) => {
      if (!item || !item.d || !item.d._meta) return;
      
      // Skip if hovering the same point
      if (lastHoveredPoint === item.d._meta.t) return;
      lastHoveredPoint = item.d._meta.t;
      
      const m = item.d._meta;
      const dateStr = `${formatDate(m.t)} ${formatTimeAMPM(m.t)}`;
      const confStr = typeof m.confidence === 'number' ? `${Math.round(m.confidence*100)}%` : '';
      tipEl.innerHTML = [
        `<div class="tip-title">${m.title}</div>`,
        `<div class="tip-line"><span class="tip-label">Time:</span> ${dateStr}</div>`,
        `<div class="tip-line"><span class="tip-label">Source:</span> ${m.source || ''}</div>`,
        `<div class="tip-line"><span class="tip-label">Sentiment:</span> ${m.sentiment || ''}${confStr ? ` (${confStr})` : ''}</div>`,
        m.reason ? `<div class="tip-reason">${m.reason}</div>` : ''
      ].join('');
      
      // Position tooltip near the cursor, but keep it within bounds
      const rect = getCachedRect();
      const tooltipWidth = 400; // max-width from CSS
      const tooltipHeight = tipEl.offsetHeight || 150; // approximate height
      const offsetX = 12;
      const offsetY = 12;
      
      let left = x + offsetX;
      let top = y + offsetY;
      
      // Keep tooltip within chart bounds
      if (left + tooltipWidth > rect.width) {
        left = x - tooltipWidth - offsetX;
      }
      if (top + tooltipHeight > rect.height) {
        top = y - tooltipHeight - offsetY;
      }
      if (left < 0) left = offsetX;
      if (top < 0) top = offsetY;
      
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${top}px`;
      tipEl.classList.remove('hidden');
    };
    
    const hideTip = () => {
      lastHoveredPoint = null;
      tipEl.classList.add('hidden');
    };
    
    const canvas = window.__chart.canvas;
    const HOVER_THRESHOLD_SQUARED = 10 * 10; // 10px threshold squared
    const MAGNET_THRESHOLD_SQUARED = 25 * 25; // 25px threshold for magnet effect
    
    const handleMouseMove = (evt) => {
      // Cancel any pending animation frame
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      
      // Use requestAnimationFrame to throttle updates
      rafId = requestAnimationFrame(() => {
        const rect = getCachedRect();
        let x = evt.clientX - rect.left;
        let y = evt.clientY - rect.top;
        
        const pts = window.__chart.$newsOverlayPixels || [];
        let magnetizedX = x;
        let magnetizedY = y;
        let isMagnetized = false;
        
        // Check for magnet effect - snap to nearest news dot if within threshold
        if (pts.length > 0) {
          let closestPoint = null;
          let closestDistSquared = Infinity;
          
          for (const p of pts) {
            const distSquared = getSquaredDistance(p.x, p.y, x, y);
            if (distSquared < closestDistSquared) {
              closestDistSquared = distSquared;
              closestPoint = p;
            }
          }
          
          // If within magnet threshold, snap crosshair to the news dot
          if (closestPoint && closestDistSquared <= MAGNET_THRESHOLD_SQUARED) {
            magnetizedX = closestPoint.x;
            magnetizedY = closestPoint.y;
            isMagnetized = true;
          }
        }
        
        // Update crosshair position (use magnetized position if applicable)
        if (window.__chart) {
          const chartArea = window.__chart.chartArea;
          // Only show crosshair if mouse is within chart area
          if (x >= chartArea.left && x <= chartArea.right && 
              y >= chartArea.top && y <= chartArea.bottom) {
            window.__chart.$crosshairPosition = { 
              x: magnetizedX, 
              y: magnetizedY,
              isMagnetized: isMagnetized
            };
            window.__chart.draw();
          } else {
            window.__chart.$crosshairPosition = null;
            window.__chart.draw();
          }
        }
        
        if (pts.length === 0) {
          hideTip();
          return;
        }
        
        // Find closest point for tooltip display
        let best = null;
        let bestDistSquared = Infinity;
        
        for (const p of pts) {
          const distSquared = getSquaredDistance(p.x, p.y, x, y);
          if (distSquared < bestDistSquared) {
            bestDistSquared = distSquared;
            best = p;
          }
        }
        
        if (best && bestDistSquared <= HOVER_THRESHOLD_SQUARED) {
          showTip(window.__chart, best, magnetizedX, magnetizedY);
        } else {
          hideTip();
        }
      });
    };
    
    const onLeave = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      hideTip();
      invalidateRectCache();
      
      // Hide crosshair when mouse leaves chart
      if (window.__chart) {
        window.__chart.$crosshairPosition = null;
        window.__chart.draw();
      }
    };
    
    // Throttle mousemove events
    let lastMoveTime = 0;
    const THROTTLE_MS = 16; // ~60fps
    
    const onMove = (evt) => {
      const now = performance.now();
      if (now - lastMoveTime >= THROTTLE_MS) {
        lastMoveTime = now;
        handleMouseMove(evt);
      }
    };
    
    canvas.addEventListener('mousemove', onMove, { passive: true });
    canvas.addEventListener('mouseleave', onLeave);
    
    // Store references for cleanup
    window.__chart._onMove = onMove;
    window.__chart._onLeave = onLeave;
    window.__chart._onResize = invalidateRectCache;
    
    // Invalidate cache on window resize
    window.addEventListener('resize', invalidateRectCache, { passive: true });

    // Render legend below chart (bullish/neutral/bearish)
    const legendEl = document.getElementById("legend");
    const legendItems = [
      { label: "Bullish", fill: "#00e676", stroke: "#00c853" },
      { label: "Neutral", fill: "#ffd400", stroke: "#ffab00" },
      { label: "Bearish", fill: "#ff1744", stroke: "#d50000" },
    ];
    legendEl.innerHTML = "";
    legendItems.forEach((it) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      const dot = document.createElement("span");
      dot.className = "news-dot";
      dot.style.backgroundColor = it.fill;
      dot.style.border = `2px solid ${it.stroke}`;
      dot.style.boxShadow = `0 0 6px ${it.fill}`;
      const text = document.createElement("span");
      text.textContent = it.label;
      item.append(dot, text);
      legendEl.appendChild(item);
    });
    if (s && s.points && s.points.length) {
      meta.textContent = `${s.coin}: ${formatDate(s.points[0].t)} → ${formatDate(s.points[s.points.length-1].t)} (${s.source})`;
    } else {
      meta.textContent = "No data";
    }

    // Render news list below chart
    const list = document.getElementById("news-list");
    list.innerHTML = "";
    
    if (newsPoints.length > 0) {
      const colorsFor = (s) => {
        if (s === "bullish") return { fill: "#00e676", stroke: "#00c853" };
        if (s === "neutral") return { fill: "#ffd400", stroke: "#ffab00" };
        return { fill: "#ff1744", stroke: "#d50000" };
      };
      newsPoints.forEach((pt) => {
        const row = document.createElement("div");
        row.className = "news-item";

        // 第一行：點、時間、標題、來源
        const top = document.createElement("div");
        top.className = "news-top";
        const dot = document.createElement("span");
        dot.className = "news-dot";
        if (pt.isPriceNews) {
          // Price-only news: white dot in list with 0.5 opacity
          dot.style.opacity = '0.5';
        } 
          const c = colorsFor(pt.sentiment);
          dot.style.backgroundColor = c.fill;
          dot.style.border = `2px solid ${c.stroke}`;
          dot.style.boxShadow = `0 0 6px ${c.fill}`;
        const time = document.createElement("span");
        time.className = "news-time";
        time.textContent = `${formatDate(pt.t)} ${formatTimeAMPM(pt.t)}`;
        const title = document.createElement("a");
        title.className = "news-title";
        title.textContent = pt.title;
        title.href = pt.link || "#";
        title.target = "_blank";
        const src = document.createElement("span");
        src.className = "news-source";
        src.textContent = pt.source || "";
        top.append(dot, time, title, src);

        // 第二行：confidence、reason
        const bottom = document.createElement("div");
        bottom.className = "news-bottom";
        const conf = document.createElement("span");
        conf.className = "news-confidence";
        if (typeof pt.confidence === 'number') conf.textContent = `Confidence: ${Math.round(pt.confidence*100)}%`;
        const tf = document.createElement("span");
        tf.className = "news-timeframe";
        if (pt.timeframe) tf.textContent = `Timeframe: ${pt.timeframe}`;
        const reason = document.createElement("span");
        reason.className = "news-reason";
        reason.textContent = pt.reason || "";
        bottom.append(conf, tf, reason);

        row.append(top, bottom);
        list.appendChild(row);
      });
    }
  } catch (e) {
    stopLoadingAnimation();
    if (overlay) overlay.classList.add("hidden");
    if (loadBtn) loadBtn.classList.remove("loading");
    meta.textContent = `Failed to load: ${e.message}`;
    console.error("Render error:", e);
  }
}

document.getElementById("loadBtn").addEventListener("click", render);
window.addEventListener("load", () => { ensureDefaultDate(); render(); });

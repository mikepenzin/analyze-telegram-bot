import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import {
  Chart,
  LinearScale,
  CategoryScale,
  BarElement,
  LineElement,
  PointElement,
  Legend,
  Title,
  Tooltip,
} from "chart.js";
import type { ChartConfiguration, ChartDataset, Plugin } from "chart.js";
import type { Candle, TASnapshot, ChartOptions } from "@repo/shared";

// ─── Register Chart.js components ────────────────────────────────────────────

Chart.register(
  LinearScale,
  CategoryScale,
  BarElement,
  LineElement,
  PointElement,
  Legend,
  Title,
  Tooltip
);

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_HEIGHT = 600;
const BACKGROUND_COLOR = "#131722";
const GRID_COLOR = "rgba(255, 255, 255, 0.06)";
const TEXT_COLOR = "#9ba3b2";

const EMA_COLORS: Record<string, string> = {
  ema9: "#f7c59f",
  ema21: "#00bfff",
  ema50: "#2ecc71",
  ema150: "#e74c3c",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeEMASeries(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

function createWickPlugin(candles: Candle[]): Plugin {
  return {
    id: "candleWick",
    beforeDatasetDraw(chart, args) {
      if (args.index !== 0) return;
      const meta = chart.getDatasetMeta(0);
      const ctx = chart.ctx;
      const yScale = chart.scales["y"];

      ctx.save();
      for (let i = 0; i < meta.data.length; i++) {
        const bar = meta.data[i];
        const candle = candles[i];
        if (!candle) continue;

        const x = bar.x;
        const highY = yScale.getPixelForValue(candle.high);
        const lowY = yScale.getPixelForValue(candle.low);

        ctx.beginPath();
        ctx.strokeStyle = candle.close >= candle.open ? "#26a69a" : "#ef5350";
        ctx.lineWidth = 1;
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ─── Renderer Instance Cache ─────────────────────────────────────────────────

const rendererCache = new Map<number, ChartJSNodeCanvas>();

function getRenderer(width: number): ChartJSNodeCanvas {
  if (!rendererCache.has(width)) {
    rendererCache.set(
      width,
      new ChartJSNodeCanvas({
        width,
        height: CHART_HEIGHT,
        backgroundColour: BACKGROUND_COLOR,
      })
    );
  }
  return rendererCache.get(width)!;
}

// ─── Main Render Function ─────────────────────────────────────────────────────

export async function renderChart(
  candles: Candle[],
  snapshot: TASnapshot,
  options: ChartOptions
): Promise<Buffer> {
  const { width, timeframe } = options;
  const renderer = getRenderer(width);

  // Date labels for category X axis
  const labels = candles.map((c) => {
    const d = new Date(c.timestamp);
    return timeframe === "1d"
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  });

  // Candlestick bodies as floating bars: [min(open,close), max(open,close)]
  const bodyDataset: ChartDataset<"bar"> = {
    type: "bar",
    label: snapshot.symbol,
    data: candles.map((c) => [Math.min(c.open, c.close), Math.max(c.open, c.close)]),
    backgroundColor: candles.map((c) =>
      c.close >= c.open ? "#26a69a" : "#ef5350"
    ),
    borderColor: candles.map((c) =>
      c.close >= c.open ? "#26a69a" : "#ef5350"
    ),
    borderWidth: 1,
    yAxisID: "y",
    barPercentage: 0.8,
    categoryPercentage: 0.9,
  };

  // EMA lines — full series computed from close prices
  const closes = candles.map((c) => c.close);
  const emaEntries: Array<{ key: string; period: number; label: string }> = [
    { key: "ema9", period: 9, label: "EMA 9" },
    { key: "ema21", period: 21, label: "EMA 21" },
    { key: "ema50", period: 50, label: "EMA 50" },
    { key: "ema150", period: 150, label: "EMA 150" },
  ];

  const emaDatasets: ChartDataset<"line">[] = emaEntries
    .filter(({ key }) => snapshot[key as keyof TASnapshot] !== null)
    .map(({ key, period, label }) => ({
      type: "line" as const,
      label,
      data: computeEMASeries(closes, period) as (number | null)[],
      borderColor: EMA_COLORS[key],
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      spanGaps: false,
      yAxisID: "y",
      fill: false,
    }));

  // Volume bars
  const volumeDataset: ChartDataset<"bar"> = {
    type: "bar",
    label: "Volume",
    data: candles.map((c) => c.volume),
    backgroundColor: candles.map((c) =>
      c.close >= c.open ? "rgba(38, 166, 154, 0.35)" : "rgba(239, 83, 80, 0.35)"
    ),
    borderWidth: 0,
    yAxisID: "yVolume",
  };

  const maxVolume = Math.max(...candles.map((c) => c.volume));
  const minClose = Math.min(...candles.map((c) => c.low));
  const maxClose = Math.max(...candles.map((c) => c.high));
  const pricePad = (maxClose - minClose) * 0.05;

  const title = `${snapshot.symbol} — ${timeframe === "1d" ? "Daily" : "Weekly"} | ${snapshot.trendState.toUpperCase()}${snapshot.partialCandle ? " (live)" : ""}`;

  const config: ChartConfiguration<"bar"> = {
    type: "bar",
    data: {
      labels,
      datasets: [bodyDataset, ...emaDatasets, volumeDataset] as ChartDataset<"bar">[],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            color: TEXT_COLOR,
            font: { size: 11 },
            filter: (item) =>
              item.text !== snapshot.symbol && item.text !== "Volume",
          },
        },
        title: {
          display: true,
          text: title,
          color: "#d1d4dc",
          font: { size: 14, weight: "bold" as const },
        },
      },
      scales: {
        x: {
          type: "category",
          grid: { color: GRID_COLOR },
          ticks: {
            color: TEXT_COLOR,
            maxRotation: 0,
            maxTicksLimit: timeframe === "1d" ? 12 : 8,
          },
        },
        y: {
          position: "right",
          grid: { color: GRID_COLOR },
          ticks: { color: TEXT_COLOR },
          min: minClose - pricePad,
          max: maxClose + pricePad,
        },
        yVolume: {
          position: "left",
          grid: { display: false },
          ticks: { display: false },
          max: maxVolume * 5,
          min: 0,
        },
      },
    },
    plugins: [createWickPlugin(candles)],
  };

  return renderer.renderToBuffer(config);
}

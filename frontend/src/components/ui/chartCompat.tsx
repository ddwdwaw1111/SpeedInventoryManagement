type BarChartProps<Row extends Record<string, unknown>> = {
  dataset: Row[];
  grid?: unknown;
  height?: number;
  hideLegend?: boolean;
  margin?: { bottom?: number; left?: number; right?: number; top?: number };
  series: Array<{ color?: string; dataKey: keyof Row & string; label?: string }>;
  xAxis?: Array<{ dataKey?: keyof Row & string; scaleType?: string }>;
};

export function BarChart<Row extends Record<string, unknown>>({
  dataset,
  height = 300,
  margin = { bottom: 28, left: 36, right: 16, top: 18 },
  series,
  xAxis
}: BarChartProps<Row>) {
  const activeSeries = series[0];
  const xKey = xAxis?.[0]?.dataKey ?? "label";
  const values = dataset.map((row) => Number(row[activeSeries.dataKey] ?? 0));
  const maxValue = Math.max(1, ...values);
  const width = Math.max(520, dataset.length * 56);
  const innerWidth = width - (margin.left ?? 0) - (margin.right ?? 0);
  const innerHeight = height - (margin.top ?? 0) - (margin.bottom ?? 0);
  const barGap = 12;
  const barWidth = Math.max(18, (innerWidth - barGap * Math.max(0, dataset.length - 1)) / Math.max(1, dataset.length));

  return (
    <div className="local-chart local-chart--compat" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={activeSeries.label ?? activeSeries.dataKey}>
        <g transform={`translate(${margin.left ?? 0} ${margin.top ?? 0})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const y = innerHeight - innerHeight * step;
            return (
              <g key={step}>
                <line className="local-chart__grid-line" x1={0} x2={innerWidth} y1={y} y2={y} />
                <text className="local-chart__axis-text" x={-10} y={y + 4} textAnchor="end">{Math.round(maxValue * step)}</text>
              </g>
            );
          })}
          {dataset.map((row, index) => {
            const value = Number(row[activeSeries.dataKey] ?? 0);
            const barHeight = (value / maxValue) * innerHeight;
            const x = index * (barWidth + barGap);
            const y = innerHeight - barHeight;
            return (
              <g key={index}>
                <rect className="local-chart__bar" fill={activeSeries.color ?? "#274c77"} x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx={5} />
                <text className="local-chart__axis-text" x={x + barWidth / 2} y={innerHeight + 18} textAnchor="middle">
                  {String(row[xKey] ?? "")}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

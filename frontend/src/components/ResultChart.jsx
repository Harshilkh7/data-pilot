// src/components/ResultChart.jsx — Recharts auto-rendered visualization
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const CHART_COLORS = [
  '#00d4aa', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#10b981', '#f97316', '#ec4899', '#84cc16',
];

const AXIS_STYLE = { fontSize: 11, fill: '#606060' };
const TOOLTIP_STYLE = {
  backgroundColor: '#141414',
  border: '1px solid #242424',
  borderRadius: 8,
  fontSize: 12,
  color: '#f0f0f0',
};

export default function ResultChart({ suggestion, columns, rows }) {
  // Build chart data from rows
  const xIndex = columns.findIndex(c => c.toLowerCase() === suggestion.x.toLowerCase());
  const yIndex = columns.findIndex(c => c.toLowerCase() === suggestion.y.toLowerCase());

  const safeX = xIndex >= 0 ? xIndex : 0;
  const safeY = yIndex >= 0 ? yIndex : 1;

  const data = rows.slice(0, 50).map(row => ({
    name: String(row[safeX] ?? ''),
    value: Number(row[safeY]) || 0,
    [columns[safeX]]: String(row[safeX] ?? ''),
    [columns[safeY]]: Number(row[safeY]) || 0,
  }));

  const xKey = columns[safeX] ?? 'name';
  const yKey = columns[safeY] ?? 'value';

  const chartHeight = 280;

  if (suggestion.type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
          <XAxis
            dataKey={xKey}
            tick={AXIS_STYLE}
            angle={-35}
            textAnchor="end"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: '#242424' }}
          />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(0,212,170,0.06)' }} />
          <Bar dataKey={yKey} fill="#00d4aa" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (suggestion.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
          <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: '#242424' }} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line
            type="monotone"
            dataKey={yKey}
            stroke="#00d4aa"
            strokeWidth={2.5}
            dot={{ fill: '#00d4aa', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (suggestion.type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }) =>
              `${String(name ?? '').slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a0a0a0' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}

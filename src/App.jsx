import React, { useMemo, useState } from "react";

/**
 * AHP from Jenks app
 * - Inputs: n factors, m classes
 * - User fills per-factor class intervals (min/max) and counts
 * - App computes per-factor class-score S_i (average class index weighted by counts)
 * - Builds Saaty (1,3,5,7,9) pairwise matrix from ratios S_i/S_j
 * - Computes weights (principal eigenvector) and Consistency Ratio (CR)
 * - Exports CSVs
 *
 * Styling: TailwindCSS
 */

const RI_TABLE = {
  1: 0.0,
  2: 0.0,
  3: 0.58,
  4: 0.90,
  5: 1.12,
  6: 1.24,
  7: 1.32,
  8: 1.41,
  9: 1.45,
  10: 1.49,
  11: 1.51,
  12: 1.48,
  13: 1.56,
  14: 1.57,
  15: 1.59,
};

function mapRatioToSaaty(r) {
  if (!isFinite(r) || r <= 0) return 1; // safe guard
  if (r < 1) return 1 / mapRatioToSaaty(1 / r);
  if (r < 1.25) return 1;
  if (r < 2.5) return 3;
  if (r < 4.5) return 5;
  if (r < 6.5) return 7;
  return 9;
}

function powerMethod(A, maxIter = 1000, tol = 1e-10) {
  const n = A.length;
  let v = Array(n).fill(1 / n);
  let lambda = 0;
  for (let it = 0; it < maxIter; it++) {
    // w = A * v
    const w = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += A[i][j] * v[j];
      w[i] = sum;
    }
    const norm = w.reduce((acc, x) => acc + Math.abs(x), 0);
    if (norm === 0) break;
    const vnew = w.map((x) => x / norm);
    // Rayleigh quotient approximation for lambda
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      let Avi = 0;
      for (let j = 0; j < n; j++) Avi += A[i][j] * vnew[j];
      num += vnew[i] * Avi;
      den += vnew[i] * vnew[i];
    }
    const lambdanew = den === 0 ? 0 : num / den;
    const delta = Math.max(...vnew.map((x, i) => Math.abs(x - v[i])));
    v = vnew;
    lambda = lambdanew;
    if (delta < tol) break;
  }
  // normalize to sum 1
  const sumv = v.reduce((a, b) => a + b, 0);
  const w = sumv === 0 ? v : v.map((x) => x / sumv);
  return { weights: w, lambdaMax: lambda };
}

function csvDownload(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Types
// Removidas, pois não são necessárias em arquivos .jsx

export default function App() {
  const [n, setN] = useState(4);
  const [m, setM] = useState(5);
  const [factors, setFactors] = useState(() =>
    Array.from({ length: 4 }, (_, i) => ({
      name: `Fator ${i + 1}`,
      rows: Array.from({ length: 5 }, () => ({ min: "", max: "", count: "" })),
    }))
  );

  // When n or m changes, resize data structure
  const resizeGrid = (nNew, mNew) => {
    setFactors((prev) => {
      const copy = [];
      for (let i = 0; i < nNew; i++) {
        const prevFactor = prev[i];
        const name = prevFactor?.name ?? `Fator ${i + 1}`;
        const rows = [];
        for (let k = 0; k < mNew; k++) {
          const prevRow = prevFactor?.rows?.[k];
          rows.push({
            min: prevRow?.min ?? "",
            max: prevRow?.max ?? "",
            count: prevRow?.count ?? "",
          });
        }
        copy.push({ name, rows });
      }
      return copy;
    });
  };

  const onChangeN = (val) => {
    const nNew = Math.max(2, Math.min(15, Math.floor(val) || 2));
    setN(nNew);
    resizeGrid(nNew, m);
  };

  const onChangeM = (val) => {
    const mNew = Math.max(3, Math.min(9, Math.floor(val) || 3));
    setM(mNew);
    resizeGrid(n, mNew);
  };

  const classScores = useMemo(() => {
    // Compute S_i for each factor
    return factors.map((f) => {
      let total = 0;
      let weighted = 0;
      f.rows.forEach((r, idx) => {
        const k = idx + 1; // class index 1..m
        const c = Number(r.count);
        if (Number.isFinite(c) && c > 0) {
          total += c;
          weighted += k * c;
        }
      });
      const S = total > 0 ? weighted / total : 0;
      return { name: f.name, S, total };
    });
  }, [factors]);

  const saatyMatrix = useMemo(() => {
    const nFactors = factors.length;
    const A = Array.from({ length: nFactors }, () => Array(nFactors).fill(1));
    const S = classScores.map((x) => x.S);

    for (let i = 0; i < nFactors; i++) {
      for (let j = 0; j < nFactors; j++) {
        if (i === j) { A[i][j] = 1; continue; }
        const Si = S[i];
        const Sj = S[j];
        if (Si <= 0 && Sj <= 0) { A[i][j] = 1; continue; }
        if (Sj === 0) { A[i][j] = 9; continue; }
        const R = Si / Sj;
        const s = mapRatioToSaaty(R);
        A[i][j] = s;
        A[j][i] = 1 / s;
      }
    }
    return A;
  }, [classScores, factors.length]);

  const results = useMemo(() => {
    const nFactors = saatyMatrix.length;
    if (nFactors < 2) return null;
    const { weights, lambdaMax } = powerMethod(saatyMatrix);
    const CI = nFactors > 2 ? (lambdaMax - nFactors) / (nFactors - 1) : 0;
    const RI = RI_TABLE[nFactors] ?? 1.59; // fallback
    const CR = RI === 0 ? 0 : CI / RI;
    return { weights, lambdaMax, CI, CR };
  }, [saatyMatrix]);

  const anyZeroTotals = useMemo(() => classScores.some((x) => x.total === 0), [classScores]);

  const downloadMatrixCSV = () => {
    const header = ["", ...factors.map((f) => f.name)];
    const rows = [header];
    saatyMatrix.forEach((row, i) => {
      rows.push([factors[i].name, ...row.map((v) => String(Number.isFinite(v) ? +v.toFixed(6) : v))]);
    });
    csvDownload("matriz_saaty.csv", rows);
  };

  const downloadWeightsCSV = () => {
    const rows = [["Fator", "Peso"]];
    results?.weights.forEach((w, i) => rows.push([factors[i].name, String(+w.toFixed(6))]));
    csvDownload("pesos_ahp.csv", rows);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">AHP a partir de quebras (Jenks)</h1>
        <p className="text-gray-600 mb-6">Preencha as classes de cada fator (intervalos e contagens). O app gera a matriz pareada na escala de Saaty (1–9), os pesos e o índice de consistência.</p>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow">
            <label className="block text-sm font-medium mb-1">Número de fatores (n)</label>
            <input
              type="number"
              min={2}
              max={15}
              value={n}
              onChange={(e) => onChangeN(Number(e.target.value))}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>
          <div className="p-4 bg-white rounded-2xl shadow">
            <label className="block text-sm font-medium mb-1">Número de classes (m)</label>
            <input
              type="number"
              min={3}
              max={9}
              value={m}
              onChange={(e) => onChangeM(Number(e.target.value))}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>
          <div className="p-4 bg-white rounded-2xl shadow flex items-end justify-between gap-2">
            <button
              onClick={downloadMatrixCSV}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow"
            >
              Baixar Matriz (CSV)
            </button>
            <button
              onClick={downloadWeightsCSV}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl shadow"
            >
              Baixar Pesos (CSV)
            </button>
          </div>
        </div>

        {/* Factors editor */}
        <div className="space-y-8">
          {factors.map((f, fi) => (
            <div key={fi} className="bg-white rounded-2xl shadow p-4">
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="text"
                  value={f.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFactors((prev) => {
                      const copy = [...prev];
                      copy[fi] = { ...copy[fi], name: val };
                      return copy;
                    });
                  }}
                  className="text-lg font-semibold border rounded-xl px-3 py-1 w-full md:w-1/2"
                />
                <div className="text-sm text-gray-500 ml-auto">
                  Escore médio (classes):
                  <span className="ml-2 font-semibold">{classScores[fi]?.S?.toFixed(3)}</span>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="px-3 py-2 rounded-l-xl">Classe</th>
                      <th className="px-3 py-2">Mínimo</th>
                      <th className="px-3 py-2">Máximo</th>
                      <th className="px-3 py-2 rounded-r-xl">Contagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: m }).map((_, k) => (
                      <tr key={k} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono">{k + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={f.rows[k]?.min ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFactors((prev) => {
                                const copy = [...prev];
                                const rows = [...copy[fi].rows];
                                rows[k] = { ...rows[k], min: val };
                                copy[fi] = { ...copy[fi], rows };
                                return copy;
                              });
                            }}
                            placeholder="min"
                            className="w-full border rounded-lg px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={f.rows[k]?.max ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFactors((prev) => {
                                const copy = [...prev];
                                const rows = [...copy[fi].rows];
                                rows[k] = { ...rows[k], max: val };
                                copy[fi] = { ...copy[fi], rows };
                                return copy;
                              });
                            }}
                            placeholder="max"
                            className="w-full border rounded-lg px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={f.rows[k]?.count ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFactors((prev) => {
                                const copy = [...prev];
                                const rows = [...copy[fi].rows];
                                rows[k] = { ...rows[k], count: val };
                                copy[fi] = { ...copy[fi], rows };
                                return copy;
                              });
                            }}
                            placeholder="0"
                            className="w-full border rounded-lg px-2 py-1"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Results */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="text-xl font-semibold mb-3">Matriz pareada (Saaty 1–9)</h2>
            {anyZeroTotals && (
              <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Aviso: há fator com <b>contagem total = 0</b>. A matriz pode ficar pouco informativa para esse fator.
              </div>
            )}
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2 rounded-l-xl">Fator</th>
                    {factors.map((f, j) => (
                      <th key={j} className="px-3 py-2">{f.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saatyMatrix.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold">{factors[i].name}</td>
                      {row.map((v, j) => (
                        <td key={j} className="px-3 py-2 font-mono">{Number.isFinite(v) ? +v.toFixed(4) : ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="text-xl font-semibold mb-3">Pesos e consistência</h2>
            {results && (
              <>
                <div className="overflow-auto mb-4">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-left">
                        <th className="px-3 py-2 rounded-l-xl">Fator</th>
                        <th className="px-3 py-2">Peso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.weights.map((w, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2">{factors[i].name}</td>
                          <td className="px-3 py-2 font-mono">{w.toFixed(6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded-xl border">
                    <div className="text-gray-600">λ<sub>máx</sub></div>
                    <div className="font-mono text-lg">{results.lambdaMax.toFixed(6)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl border">
                    <div className="text-gray-600">CI</div>
                    <div className="font-mono text-lg">{results.CI.toFixed(6)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl border">
                    <div className="text-gray-600">CR</div>
                    <div className="font-mono text-lg">{results.CR.toFixed(6)}</div>
                  </div>
                  <div className={`p-3 rounded-xl border ${results.CR <= 0.10 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                    <div className="text-gray-600">Status</div>
                    <div className="font-semibold">{results.CR <= 0.10 ? 'Consistência aceitável (CR ≤ 0,10)' : 'Consistência baixa (revise comparações)'}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-8 text-xs text-gray-500">
          <p>Notas: Classe 1 = melhor, Classe m = pior. O escore por fator é a média ponderada do número da classe pelos totais. A transformação para Saaty usa faixas: [1,1.25)→1, [1.25,2.5)→3, [2.5,4.5)→5, [4.5,6.5)→7, ≥6.5→9 (aplica-se reciprocidade quando R&lt;1).</p>
        </div>
      </div>
    </div>
  );
}
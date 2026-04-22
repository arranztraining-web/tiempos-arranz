import React, { useState, useEffect, useMemo, useCallback } from "react";
import Papa from "papaparse";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { RefreshCw, Activity, Users, TrendingDown, Clock, Search, ChevronDown, X } from "lucide-react";

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRF971GUDMgBYnATdkyyxfizaxojZnkggtN8ra33NCORUO-XSDX--kL0MSYh8aMo6yOkUJQ63pVDqpP/pub?output=csv";
const REFRESH_MS = 60 * 1000; // 60 segundos

// Parsea un tiempo en formato "19.05", "17"4", "1'16,50", "1.16,50", etc. a segundos (número)
function parseTime(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Normalizar separadores
  // Patrones que se ven: 19.05  17"4  16'49  1'16,50  1.16,50  10"63
  // Interpretación:
  //   - Apóstrofe ' o punto . entre minutos y segundos cuando hay minutos (1'16,50 => 1 min 16.50 s)
  //   - Comilla " como separador de decimales (10"63 => 10.63 s)
  //   - Coma , como decimal
  s = s.replace(/\u2019/g, "'"); // apóstrofe tipográfico a recto

  // Caso con minutos: un separador (' o .) seguido de al menos un dígito y luego otro separador decimal
  // Ejemplos: 1'16,50  1.16,50  1'16.50
  const conMin = s.match(/^(\d+)[.'](\d{1,2})[,.:"](\d{1,3})$/);
  if (conMin) {
    const min = parseInt(conMin[1], 10);
    const seg = parseInt(conMin[2], 10);
    const dec = parseInt(conMin[3], 10) / Math.pow(10, conMin[3].length);
    return min * 60 + seg + dec;
  }
  // Caso con minutos sin decimales: 1'16  o 16'49
  const conMinSinDec = s.match(/^(\d+)'(\d{1,2})$/);
  if (conMinSinDec) {
    return parseInt(conMinSinDec[1], 10) * 60 + parseInt(conMinSinDec[2], 10);
  }
  // Caso segundos con " como decimal: 10"63  17"4
  const comilla = s.match(/^(\d+)"(\d{1,3})$/);
  if (comilla) {
    const dec = parseInt(comilla[2], 10) / Math.pow(10, comilla[2].length);
    return parseInt(comilla[1], 10) + dec;
  }
  // Caso estándar con , o . como decimal: 19,05  19.05
  const normal = s.replace(",", ".");
  const n = parseFloat(normal);
  return isNaN(n) ? null : n;
}

function parsePercent(raw) {
  if (raw == null) return null;
  const s = String(raw).replace("%", "").replace(",", ".").trim();
  if (!s || s === "#N/A" || s === "#DIV/0!") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  if (!s || s === "#N/A") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Intenta parsear fecha en formato dd/mm/yyyy
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, mo, d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatTimeShort(t) {
  if (t == null || isNaN(t)) return "—";
  if (t >= 60) {
    const min = Math.floor(t / 60);
    const seg = (t - min * 60).toFixed(2);
    return `${min}'${seg.padStart(5, "0")}`;
  }
  return t.toFixed(2) + "s";
}

// Muestra un valor tal cual vino de la hoja (sin redondeos), limpiando espacios,
// traduciendo vacíos a guión, y convirtiendo puntos decimales a comas (formato español).
// No toca los apóstrofes de minutos (ej. 1'16,50 se mantiene igual).
function showRaw(v) {
  if (v == null) return "—";
  let s = String(v).trim();
  if (s === "" || s === "#N/A" || s === "#DIV/0!") return "—";
  // Si contiene '.' y no es un año/fecha (no tiene '/' ni barras), convertir a coma
  if (s.includes(".") && !s.includes("/") && !s.includes(":")) {
    s = s.replace(/\./g, ",");
  }
  return s;
}

// Color graduado según % pérdida al estilo Google Sheets:
//   0-1 excelente (verde), 1-2 bueno (lima), 2-3.5 normal (amarillo),
//   3.5-5 atención (naranja), >5 crítico (rojo)
// Versión para fondo oscuro (KPIs globales, perfil del atleta): tonos claros/saturados
function perdColor(p) {
  if (p == null) return "#6b7280";
  if (p < 1) return "#22c55e";
  if (p < 2) return "#84cc16";
  if (p < 3.5) return "#facc15";
  if (p < 5) return "#fb923c";
  return "#ef4444";
}

// Versión para fondo blanco (tarjetas de sesión): tonos oscurecidos para buen contraste
function perdColorLight(p) {
  if (p == null) return "#6b7280";
  if (p < 1) return "#15803d";
  if (p < 2) return "#65a30d";
  if (p < 3.5) return "#ca8a04";
  if (p < 5) return "#ea580c";
  return "#dc2626";
}

// Color RPE — fondo oscuro
function rpeColor(v) {
  if (v == null) return "#6b7280";
  if (v <= 5) return "#22c55e";
  if (v <= 7) return "#facc15";
  if (v <= 9) return "#fb923c";
  return "#ef4444";
}

// Color RPE — fondo blanco
function rpeColorLight(v) {
  if (v == null) return "#6b7280";
  if (v <= 5) return "#15803d";
  if (v <= 7) return "#ca8a04";
  if (v <= 9) return "#ea580c";
  return "#dc2626";
}

export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedAthlete, setSelectedAthlete] = useState("__ALL__");
  const [selectedYear, setSelectedYear] = useState("__ALL__");
  const [refreshing, setRefreshing] = useState(false);

  const [fetchMethod, setFetchMethod] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      // Cache buster para evitar caché del navegador
      const cacheBuster = "&_=" + Date.now();
      const directUrl = CSV_URL + cacheBuster;
      // Lista de estrategias con nombre para diagnóstico
      const attempts = [
        { name: "directo", url: directUrl },
        { name: "corsproxy.io", url: "https://corsproxy.io/?" + encodeURIComponent(directUrl) },
        { name: "allorigins", url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(directUrl) },
        { name: "codetabs", url: "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(directUrl) },
      ];

      let text = null;
      let usedMethod = null;
      const errors = [];
      for (const a of attempts) {
        try {
          const res = await fetch(a.url);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const t = await res.text();
          if (!t || t.length < 10) throw new Error("respuesta vacía");
          text = t;
          usedMethod = a.name;
          break;
        } catch (e) {
          errors.push(a.name + ": " + (e.message || e));
        }
      }
      if (text == null) throw new Error("Todos los métodos fallaron → " + errors.join(" | "));

      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      setHeaders(parsed.meta.fields || []);
      setRows(parsed.data || []);
      setLastUpdate(new Date());
      setFetchMethod(usedMethod);
      setError(null);
    } catch (e) {
      setError(e.message || "Error al cargar datos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // Normalizar filas
  const normalized = useMemo(() => {
    return rows
      .map((r) => {
        // Buscar columnas por nombre tolerando variaciones
        const get = (keys) => {
          for (const k of keys) {
            if (r[k] !== undefined && r[k] !== "") return r[k];
          }
          return "";
        };
        const atleta = get(["ATLETA", "Atleta", "atleta"]);
        const fechaRaw = get(["FECHA", "Fecha", "fecha"]);
        const series = get(["SERIES", "Series"]);
        // Buscar recuperación: cualquier cabecera que empiece por "REC" (REC, RECU, RECUP, RECUPERACIÓN, etc.)
        let recuperacion = "";
        for (const k of Object.keys(r)) {
          const kNorm = String(k).trim().toUpperCase();
          if (kNorm.startsWith("REC") && r[k] !== undefined && r[k] !== "") {
            recuperacion = r[k];
            break;
          }
        }
        const salida = get(["SALIDA", "Salida"]);
        const zap = get(["ZAPATILLAS", "Zapatillas"]);
        const rpeFRaw = get(["RPE físico", "RPE fisico", "RPE físico ", "RPE Físico"]);
        const rpeMRaw = get(["RPE mental", "RPE Mental"]);
        const rpeF = parseNumber(rpeFRaw);
        const rpeM = parseNumber(rpeMRaw);
        const comentarios = get(["COMENTARIOS", "Comentarios"]);
        const perd1Raw = get(["% PÉRDIDA 1", "% PERDIDA 1", "%PÉRDIDA 1"]);
        const perd2Raw = get(["% PÉRDIDA 2", "% PERDIDA 2"]);
        const perd1 = parsePercent(perd1Raw);
        const perd2 = parsePercent(perd2Raw);
        const media1Raw = get(["MEDIA 1"]);
        const media2Raw = get(["MEDIA 2"]);
        const media1 = parseTime(media1Raw);
        const media2 = parseTime(media2Raw);
        const dist1 = parseNumber(get(["DIST 1"]));
        const dist2 = parseNumber(get(["DIST 2"]));
        const tiemposRaw = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"].map((k) => get([k]));
        const tiempos = tiemposRaw.map((v) => parseTime(v));
        return {
          atleta: String(atleta).trim(),
          fecha: parseDate(fechaRaw),
          fechaRaw,
          series,
          recuperacion,
          salida,
          zapatillas: zap,
          rpeF,
          rpeM,
          comentarios,
          perd1,
          perd2,
          perd1Raw,
          perd2Raw,
          media1,
          media2,
          media1Raw,
          media2Raw,
          dist1,
          dist2,
          tiempos,
          tiemposRaw,
          rpeFRaw,
          rpeMRaw,
          _raw: r,
        };
      })
      .filter((r) => r.atleta); // descartar filas sin atleta
  }, [rows]);

  const athletes = useMemo(() => {
    const set = new Set(normalized.map((r) => r.atleta).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [normalized]);

  // Años disponibles en los datos (extraídos de la fecha)
  const years = useMemo(() => {
    const set = new Set();
    for (const r of normalized) {
      if (r.fecha) set.add(r.fecha.getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a); // más recientes primero
  }, [normalized]);

  const filtered = useMemo(() => {
    return normalized.filter((r) => {
      if (selectedAthlete !== "__ALL__" && r.atleta !== selectedAthlete) return false;
      if (selectedYear !== "__ALL__" && (!r.fecha || r.fecha.getFullYear() !== selectedYear)) return false;
      return true;
    });
  }, [normalized, selectedAthlete, selectedYear]);

  // Resumen por atleta (se muestra siempre, pero resalta el seleccionado)
  const summary = useMemo(() => {
    const byAth = new Map();
    for (const r of normalized) {
      if (!byAth.has(r.atleta)) byAth.set(r.atleta, []);
      byAth.get(r.atleta).push(r);
    }
    return Array.from(byAth.entries())
      .map(([nombre, arr]) => {
        const rpes = arr.map((x) => x.rpeF).filter((v) => v != null);
        const rpesM = arr.map((x) => x.rpeM).filter((v) => v != null);
        const perds = arr.flatMap((x) => [x.perd1, x.perd2].filter((v) => v != null));

        // Calcular medias por distancia (agrupa DIST 1 con MEDIA 1 y DIST 2 con MEDIA 2)
        const mediasPorDist = new Map();
        for (const r of arr) {
          if (r.dist1 != null && r.media1 != null) {
            if (!mediasPorDist.has(r.dist1)) mediasPorDist.set(r.dist1, []);
            mediasPorDist.get(r.dist1).push(r.media1);
          }
          if (r.dist2 != null && r.media2 != null) {
            if (!mediasPorDist.has(r.dist2)) mediasPorDist.set(r.dist2, []);
            mediasPorDist.get(r.dist2).push(r.media2);
          }
        }
        const distancias = Array.from(mediasPorDist.entries())
          .map(([dist, medias]) => ({
            dist,
            media: medias.reduce((a, b) => a + b, 0) / medias.length,
            n: medias.length,
          }))
          .sort((a, b) => a.dist - b.dist); // ordenar por distancia ascendente

        return {
          nombre,
          sesiones: arr.length,
          rpeF: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
          rpeM: rpesM.length ? rpesM.reduce((a, b) => a + b, 0) / rpesM.length : null,
          perdMedia: perds.length ? perds.reduce((a, b) => a + b, 0) / perds.length : null,
          ultima: arr.map((x) => x.fecha).filter(Boolean).sort((a, b) => b - a)[0] || null,
          distancias,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [normalized]);

  // Sesiones ordenadas por fecha desc (todas las filtradas, sin límite)
  const recent = useMemo(() => {
    return [...filtered]
      .sort((a, b) => {
        const da = a.fecha ? a.fecha.getTime() : 0;
        const db = b.fecha ? b.fecha.getTime() : 0;
        return db - da;
      });
  }, [filtered]);

  // Evolución para gráficos (solo tiene sentido cuando hay un atleta seleccionado, si no, agregar global)
  const evolution = useMemo(() => {
    const sorted = [...filtered]
      .filter((r) => r.fecha)
      .sort((a, b) => a.fecha - b.fecha);
    return sorted.map((r) => ({
      fecha: formatDate(r.fecha),
      ts: r.fecha.getTime(),
      rpeF: r.rpeF,
      rpeM: r.rpeM,
      perd1: r.perd1,
      perd2: r.perd2,
      media1: r.media1,
      media2: r.media2,
    }));
  }, [filtered]);

  const totalSesiones = normalized.length;
  const totalAtletas = athletes.length;
  const rpeGlobal = useMemo(() => {
    const vals = normalized.map((r) => r.rpeF).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [normalized]);
  const perdGlobal = useMemo(() => {
    const vals = normalized.flatMap((r) => [r.perd1, r.perd2].filter((v) => v != null));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [normalized]);

  return (
    <div className="dashboard-root" style={styles.root}>
      <style>{cssText}</style>

      {/* Fondo decorativo deportivo - capa detrás de todo el contenido */}
      <div className="sports-bg" aria-hidden="true">
        <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" style={styles.sportsBgSvg}>
          <defs>
            <linearGradient id="yellowWave" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0" />
              <stop offset="40%" stopColor="#facc15" stopOpacity="0.85" />
              <stop offset="60%" stopColor="#eab308" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="yellowWaveSmall" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0" />
              <stop offset="50%" stopColor="#facc15" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grupo superior derecho - líneas finas blancas como estelas de velocidad */}
          <g opacity="0.18" stroke="#ffffff" strokeWidth="1" fill="none">
            <path d="M 1440 -50 Q 1200 120 900 260 T 400 480" />
            <path d="M 1440 -20 Q 1220 140 940 280 T 440 500" />
            <path d="M 1440 10 Q 1240 160 980 300 T 480 520" />
            <path d="M 1440 40 Q 1260 180 1020 320 T 520 540" />
            <path d="M 1440 70 Q 1280 200 1060 340 T 560 560" />
            <path d="M 1440 100 Q 1300 220 1100 360 T 600 580" />
            <path d="M 1440 130 Q 1320 240 1140 380 T 640 600" />
            <path d="M 1440 160 Q 1340 260 1180 400 T 680 620" />
          </g>

          {/* Swoosh amarillo grande - onda superior */}
          <path
            d="M -100 180 Q 400 -20 900 140 T 1540 100"
            stroke="url(#yellowWave)"
            strokeWidth="3"
            fill="none"
            opacity="0.35"
          />

          {/* Swoosh amarillo inferior - cruzando la parte baja */}
          <path
            d="M -100 820 Q 400 620 900 780 T 1540 720"
            stroke="url(#yellowWave)"
            strokeWidth="4"
            fill="none"
            opacity="0.28"
          />

          {/* Swoosh amarillo medio derecha */}
          <path
            d="M 600 500 Q 900 400 1200 450 T 1540 480"
            stroke="url(#yellowWaveSmall)"
            strokeWidth="2"
            fill="none"
            opacity="0.25"
          />
        </svg>
      </div>

      {/* Contenido principal */}
      <div style={styles.content}>

      <header className="dashboard-header" style={styles.header}>
        <div className="dashboard-header-bar" style={styles.headerAccentBar} />
        <div className="dashboard-header-left" style={styles.headerLeft}>
          <img src="/logo.png" alt="Sprint" className="dashboard-logo" style={styles.logo} />
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <div className="dashboard-eyebrow" style={styles.eyebrow}>▸ TRACK &amp; FIELD · CONTROL</div>
            <h1 className="dashboard-title" style={styles.title}>
              <span style={styles.titleAccent}>TIEMPOS</span> ARRANZ
            </h1>
            <div className="dashboard-club" style={styles.club}>AGRUPACIÓN DEPORTIVA SPRINT</div>
            <div className="dashboard-subtitle" style={styles.subtitle}>Panel de sesiones de entrenamiento</div>
          </div>
        </div>
        <div className="dashboard-header-right" style={styles.headerRight}>
          <div className="dashboard-last-update" style={styles.lastUpdate}>
            <Clock size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            {lastUpdate ? `Actualizado ${lastUpdate.toLocaleTimeString("es-ES")}` : "Cargando..."}
            <div style={styles.refreshHint}>auto cada 60 s</div>
          </div>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="dashboard-refresh-btn"
            style={{ ...styles.refreshBtn, opacity: refreshing ? 0.5 : 1 }}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      {error && (
        <div style={styles.errorBox}>
          Error al cargar: {error}. Reintentando automáticamente…
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div style={styles.loading}>Cargando datos de la hoja...</div>
      ) : (
        <>
          {/* KPIs globales */}
          <section className="kpi-grid" style={styles.kpiGrid}>
            <KPI icon={<Activity size={16} />} label="Sesiones" value={totalSesiones} />
            <KPI icon={<Users size={16} />} label="Atletas" value={totalAtletas} />
            <KPI
              icon={<TrendingDown size={16} />}
              label="RPE medio"
              value={rpeGlobal != null ? rpeGlobal.toFixed(1) : "—"}
              suffix="/10"
              valueColor={rpeColor(rpeGlobal)}
            />
          </section>

          {/* Selectores de filtro */}
          <section className="filter-bar" style={styles.filterBar}>
            <div style={styles.filtersRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AthleteSelect
                  athletes={athletes}
                  value={selectedAthlete}
                  onChange={setSelectedAthlete}
                  summary={summary}
                />
              </div>
              <div style={styles.yearFilter}>
                <label style={styles.filterLabel}>AÑO</label>
                <div style={styles.yearChips}>
                  <button
                    type="button"
                    onClick={() => setSelectedYear("__ALL__")}
                    style={{
                      ...styles.yearChip,
                      ...(selectedYear === "__ALL__" ? styles.yearChipActive : {}),
                    }}
                  >
                    Todos
                  </button>
                  {years.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setSelectedYear(y)}
                      style={{
                        ...styles.yearChip,
                        ...(selectedYear === y ? styles.yearChipActive : {}),
                      }}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Sección 1: Perfil del atleta (solo al filtrar) */}
          {selectedAthlete !== "__ALL__" && (() => {
            const s = summary.find((x) => x.nombre === selectedAthlete);
            if (!s) return null;
            return (
              <section className="section" style={styles.section}>
                <h2 className="section-title" style={styles.sectionTitle}>
                  <span className="section-num" style={styles.sectionNum}>01</span> Perfil del atleta
                </h2>
                <div style={styles.profileCard}>
                  <div style={styles.profileStripe} />
                  <div className="profile-main" style={styles.profileMain}>
                    <div style={styles.profileNameRow}>
                      <div className="profile-initial" style={styles.profileInitial}>
                        {s.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="profile-label" style={styles.profileLabel}>ATLETA</div>
                        <div className="profile-name" style={styles.profileName}>{s.nombre}</div>
                      </div>
                    </div>
                    <div className="profile-stats" style={styles.profileStats}>
                      <div style={styles.profileStat}>
                        <div style={styles.profileStatLabel}>Sesiones</div>
                        <div className="profile-stat-val" style={styles.profileStatVal}>{s.sesiones}</div>
                      </div>
                      <div style={styles.profileStat}>
                        <div style={styles.profileStatLabel}>RPE físico</div>
                        <div
                          className="profile-stat-val"
                          style={{
                            ...styles.profileStatVal,
                            color: rpeColor(s.rpeF),
                          }}
                        >
                          {s.rpeF != null ? s.rpeF.toFixed(1) : "—"}
                          <span style={styles.profileStatSuffix}>/10</span>
                        </div>
                      </div>
                      <div style={styles.profileStat}>
                        <div style={styles.profileStatLabel}>RPE mental</div>
                        <div
                          className="profile-stat-val"
                          style={{
                            ...styles.profileStatVal,
                            color: rpeColor(s.rpeM),
                          }}
                        >
                          {s.rpeM != null ? s.rpeM.toFixed(1) : "—"}
                          <span style={styles.profileStatSuffix}>/10</span>
                        </div>
                      </div>
                      <div style={styles.profileStat}>
                        <div style={styles.profileStatLabel}>Última sesión</div>
                        <div className="profile-stat-val profile-stat-val-date" style={{ ...styles.profileStatVal, fontSize: 20 }}>
                          {formatDate(s.ultima)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* Sección: Últimas sesiones - Tarjetas visuales */}
          <section className="section" style={styles.section}>
            <h2 className="section-title" style={styles.sectionTitle}>
              <span className="section-num" style={styles.sectionNum}>
                {selectedAthlete !== "__ALL__" ? "02" : "01"}
              </span>{" "}
              Sesiones
              {selectedAthlete !== "__ALL__" && (
                <span className="filter-tag" style={styles.filterTag}>· {selectedAthlete}</span>
              )}
              {selectedYear !== "__ALL__" && (
                <span className="filter-tag" style={styles.filterTag}>· {selectedYear}</span>
              )}
              <span style={styles.sessionsCount}>{recent.length}</span>
            </h2>
            <div className="sessions-grid" style={styles.sessionsGrid}>
              {recent.map((r, i) => (
                <SessionCard key={i} r={r} showAthlete={selectedAthlete === "__ALL__"} />
              ))}
              {recent.length === 0 && (
                <div style={{ textAlign: "center", padding: 32, opacity: 0.5, gridColumn: "1 / -1" }}>
                  Sin sesiones para mostrar
                </div>
              )}
            </div>
          </section>

          {/* Sección: Evolución */}
          <section className="section" style={styles.section}>
            <h2 className="section-title" style={styles.sectionTitle}>
              <span className="section-num" style={styles.sectionNum}>
                {selectedAthlete !== "__ALL__" ? "03" : "02"}
              </span>{" "}
              Evolución en el tiempo
              {selectedAthlete !== "__ALL__" && (
                <span className="filter-tag" style={styles.filterTag}>· {selectedAthlete}</span>
              )}
              {selectedYear !== "__ALL__" && (
                <span className="filter-tag" style={styles.filterTag}>· {selectedYear}</span>
              )}
            </h2>

            <div className="charts-grid" style={styles.chartsGrid}>
              <div style={styles.chartCard}>
                <div style={styles.chartTitle}>RPE físico &amp; mental</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={evolution} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" stroke="#6b7280" fontSize={11} />
                    <YAxis stroke="#6b7280" fontSize={11} domain={[0, 10]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                    <Line type="monotone" dataKey="rpeF" name="Físico" stroke="#facc15" strokeWidth={2.5} dot={{ r: 3, fill: "#facc15" }} />
                    <Line type="monotone" dataKey="rpeM" name="Mental" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={styles.chartCard}>
                <div style={styles.chartTitle}>% Pérdida de velocidad</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={evolution} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" stroke="#6b7280" fontSize={11} />
                    <YAxis stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                    <Line type="monotone" dataKey="perd1" name="Bloque 1" stroke="#facc15" strokeWidth={2.5} dot={{ r: 3, fill: "#facc15" }} />
                    <Line type="monotone" dataKey="perd2" name="Bloque 2" stroke="#fb923c" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{ ...styles.chartCard, gridColumn: "1 / -1" }}>
                <div style={styles.chartTitle}>Media de tiempos (s)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={evolution} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" stroke="#6b7280" fontSize={11} />
                    <YAxis stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                    <Line type="monotone" dataKey="media1" name="Media 1" stroke="#facc15" strokeWidth={2.5} dot={{ r: 3, fill: "#facc15" }} />
                    <Line type="monotone" dataKey="media2" name="Media 2" stroke="#fde047" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <footer className="dashboard-footer" style={styles.footer}>
            Fuente: Google Sheets publicado · Se actualiza automáticamente cada 60 s · Google tarda hasta ~5 min en propagar nuevas respuestas del formulario.
            {fetchMethod && (
              <div style={{ marginTop: 6, opacity: 0.5, fontSize: 10 }}>
                [carga vía: {fetchMethod}]
              </div>
            )}
          </footer>
        </>
      )}
      </div>
    </div>
  );
}

function AthleteSelect({ athletes, value, onChange, summary }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!e.target.closest("[data-athlete-select]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Filtrar por query (normalizando acentos)
  const normalize = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = normalize(query.trim());
  const filteredList = q
    ? athletes.filter((a) => normalize(a).includes(q))
    : athletes;

  // Meta por atleta para mostrar sesiones en la lista
  const metaByName = new Map(summary.map((s) => [s.nombre, s]));

  const selectedMeta = value !== "__ALL__" ? metaByName.get(value) : null;

  return (
    <div data-athlete-select style={styles.selectWrap}>
      <label style={styles.filterLabel}>ATLETA</label>
      <div style={styles.selectRow}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            ...styles.selectBtn,
            ...(value !== "__ALL__" ? styles.selectBtnActive : {}),
          }}
        >
          <div style={styles.selectBtnLeft}>
            {value === "__ALL__" ? (
              <>
                <Users size={14} style={{ opacity: 0.6 }} />
                <span>Todos los atletas</span>
                <span style={styles.selectCount}>{athletes.length}</span>
              </>
            ) : (
              <>
                <span style={styles.selectDot} />
                <span style={styles.selectSelectedName}>{value}</span>
                {selectedMeta && (
                  <span style={styles.selectCount}>
                    {selectedMeta.sesiones} ses.
                  </span>
                )}
              </>
            )}
          </div>
          <ChevronDown
            size={16}
            style={{
              opacity: 0.5,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
            }}
          />
        </button>

        {value !== "__ALL__" && (
          <button
            type="button"
            onClick={() => onChange("__ALL__")}
            style={styles.clearBtn}
            title="Quitar filtro"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div style={styles.selectDropdown}>
          <div style={styles.searchBox}>
            <Search size={13} style={{ opacity: 0.5 }} />
            <input
              autoFocus
              placeholder="Buscar atleta..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>
          <div style={styles.selectList}>
            <div
              onClick={() => {
                onChange("__ALL__");
                setOpen(false);
                setQuery("");
              }}
              style={{
                ...styles.selectOption,
                ...(value === "__ALL__" ? styles.selectOptionActive : {}),
              }}
            >
              <Users size={13} style={{ opacity: 0.6 }} />
              <span style={{ flex: 1 }}>Todos los atletas</span>
              <span style={styles.selectOptionMeta}>{athletes.length}</span>
            </div>
            {filteredList.map((a) => {
              const m = metaByName.get(a);
              const isActive = value === a;
              return (
                <div
                  key={a}
                  onClick={() => {
                    onChange(a);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    ...styles.selectOption,
                    ...(isActive ? styles.selectOptionActive : {}),
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 600 }}>{a}</span>
                  {m && (
                    <>
                      <span style={styles.selectOptionMeta}>
                        {m.sesiones} ses.
                      </span>
                      {m.rpeF != null && (
                        <span className="select-option-rpe" style={styles.selectOptionRpe}>
                          RPE {m.rpeF.toFixed(1)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {filteredList.length === 0 && (
              <div style={styles.selectEmpty}>Sin resultados</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({ r, showAthlete }) {
  // Filtrar los tiempos válidos y prepararlos para mostrar
  // Guardamos el valor parseado (t) y el valor original tal cual está en la hoja (raw)
  const reps = r.tiempos
    .map((t, idx) => ({ t, raw: r.tiemposRaw ? r.tiemposRaw[idx] : null, idx }))
    .filter((x) => x.t != null && !isNaN(x.t));

  // Dividir en bloques según media1 / media2 + dist1 / dist2
  // Asumimos que los primeros N tiempos son del bloque 1 y el resto del bloque 2
  // Estimamos N comparando: si hay 2 bloques, dividimos por mitad aprox según distancias
  const hasTwoBlocks = r.media2 != null || r.dist2 != null || r.perd2 != null;
  let bloque1 = reps;
  let bloque2 = [];
  if (hasTwoBlocks && reps.length >= 2) {
    // Heurística: punto de corte donde el tiempo baja notablemente (cambio de distancia)
    // Si no detectamos, partimos por la mitad
    let cut = Math.ceil(reps.length / 2);
    for (let i = 1; i < reps.length; i++) {
      const prev = reps[i - 1].t;
      const curr = reps[i].t;
      // si el tiempo baja más de un 20% de golpe, es cambio de distancia
      if (prev > 0 && (prev - curr) / prev > 0.2) {
        cut = i;
        break;
      }
    }
    bloque1 = reps.slice(0, cut);
    bloque2 = reps.slice(cut);
  }

  // Para las barras visuales, tomar el peor tiempo como referencia del bloque
  const maxT1 = bloque1.length ? Math.max(...bloque1.map((x) => x.t)) : 0;
  const maxT2 = bloque2.length ? Math.max(...bloque2.map((x) => x.t)) : 0;

  const rpeFBars = r.rpeF != null ? Math.round(r.rpeF) : 0;
  const rpeMBars = r.rpeM != null ? Math.round(r.rpeM) : 0;

  return (
    <div className="session-card" style={styles.sessionCard}>
      {/* Cabecera: fecha + atleta */}
      <div style={styles.sessionHeader}>
        <div>
          <div className="session-date" style={styles.sessionDate}>{formatDate(r.fecha)}</div>
          {showAthlete && <div className="session-athlete" style={styles.sessionAthlete}>{r.atleta}</div>}
        </div>
        <div style={styles.sessionBadges}>
          {r.salida && <span style={styles.badge}>{r.salida}</span>}
          {r.zapatillas && <span style={styles.badge}>{r.zapatillas}</span>}
        </div>
      </div>

      {/* Título de la sesión (series) + recuperación al lado */}
      <div className="session-series-wrap" style={styles.sessionSeriesWrap}>
        <div className="session-series" style={styles.sessionSeries}>{r.series || "—"}</div>
        {r.recuperacion && (
          <div className="session-recu" style={styles.sessionRecu}>
            <span style={styles.sessionRecuLabel}>REC</span>
            <span style={styles.sessionRecuValue}>{r.recuperacion}</span>
          </div>
        )}
      </div>

      {/* Contenido principal: reps + lateral RPE */}
      <div className="session-body" style={{ ...styles.sessionBody, position: "relative", zIndex: 1 }}>
        <div style={styles.sessionRepsWrap}>
          {/* Bloque 1 */}
          <BlockRow
            label={hasTwoBlocks ? "Bloque 1" : "Repeticiones"}
            reps={bloque1}
            maxT={maxT1}
            dist={r.dist1}
            media={r.media1}
            mediaRaw={r.media1Raw}
            perd={r.perd1}
            perdRaw={r.perd1Raw}
          />
          {/* Bloque 2 si existe */}
          {bloque2.length > 0 && (
            <BlockRow
              label="Bloque 2"
              reps={bloque2}
              maxT={maxT2}
              dist={r.dist2}
              media={r.media2}
              mediaRaw={r.media2Raw}
              perd={r.perd2}
              perdRaw={r.perd2Raw}
            />
          )}
        </div>

        {/* Lateral RPE + distancias/medias */}
        <div className="session-rpe" style={styles.sessionRpe}>
          <RpeBar label="Físico" value={r.rpeF} raw={r.rpeFRaw} bars={rpeFBars} color={rpeColorLight(r.rpeF)} />
          <RpeBar label="Mental" value={r.rpeM} raw={r.rpeMRaw} bars={rpeMBars} color={rpeColorLight(r.rpeM)} />

          {/* Mini-panel: distancias y medias de esta sesión */}
          {(r.dist1 != null || r.dist2 != null) && (
            <div style={styles.sessionDistPanel}>
              {r.dist1 != null && (
                <div style={styles.sessionDistRow}>
                  <span style={styles.sessionDistD}>{r.dist1}m</span>
                  <span style={styles.sessionDistArrow}>⟶</span>
                  <span style={styles.sessionDistM}>
                    {r.media1Raw ? showRaw(r.media1Raw) : (r.media1 != null ? formatTimeShort(r.media1).replace(/\./g, ",") : "—")}
                  </span>
                </div>
              )}
              {r.dist2 != null && (
                <div style={styles.sessionDistRow}>
                  <span style={styles.sessionDistD}>{r.dist2}m</span>
                  <span style={styles.sessionDistArrow}>⟶</span>
                  <span style={styles.sessionDistM}>
                    {r.media2Raw ? showRaw(r.media2Raw) : (r.media2 != null ? formatTimeShort(r.media2).replace(/\./g, ",") : "—")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Comentario */}
      {r.comentarios && (
        <div className="session-comment" style={styles.sessionComment}>
          <span style={styles.commentQuote}>“</span>
          {r.comentarios}
        </div>
      )}
    </div>
  );
}

function BlockRow({ label, reps, maxT, dist, media, mediaRaw, perd, perdRaw }) {
  if (!reps.length) return null;
  return (
    <div style={styles.blockRow}>
      <div className="block-header" style={styles.blockHeader}>
        <span style={styles.blockLabel}>{label}</span>
        {dist != null && <span className="block-dist" style={styles.blockDist}>{dist}m</span>}
        {(mediaRaw || media != null) && (
          <span style={styles.blockMedia}>media {showRaw(mediaRaw) !== "—" ? showRaw(mediaRaw) : formatTimeShort(media)}</span>
        )}
        {(perdRaw || perd != null) && (
          <span
            style={{
              ...styles.blockPerd,
              color: perdColorLight(perd),
            }}
          >
            {showRaw(perdRaw) !== "—" ? showRaw(perdRaw) : "−" + perd + "%"}
          </span>
        )}
      </div>
      <div className="reps-line" style={styles.repsLine}>
        {reps.map((rep, i) => {
          const pct = maxT > 0 ? (rep.t / maxT) * 100 : 100;
          const isBest = rep.t === Math.min(...reps.map((x) => x.t));
          return (
            <div key={i} className="rep-pill" style={styles.repPill}>
              <div className="rep-num" style={styles.repNum}>T{rep.idx + 1}</div>
              <div className="rep-time" style={styles.repTime}>
                {rep.raw ? showRaw(rep.raw) : formatTimeShort(rep.t)}
              </div>
              <div style={styles.repBarTrack}>
                <div
                  style={{
                    ...styles.repBarFill,
                    width: pct + "%",
                    background: "linear-gradient(90deg, rgba(250,204,21,0.5), rgba(249,115,22,0.6))",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RpeBar({ label, value, raw, bars, color }) {
  return (
    <div className="rpe-block" style={styles.rpeBlock}>
      <div style={styles.rpeLabel}>RPE {label}</div>
      <div className="rpe-value" style={{ ...styles.rpeValue, color: value != null ? color : "var(--text)" }}>
        {raw ? showRaw(raw) : (value != null ? value : "—")}
        <span style={styles.rpeMax}>/10</span>
      </div>
      <div style={styles.rpeDots}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              ...styles.rpeDot,
              background: i < bars ? color : "rgba(0,0,0,0.12)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function KPI({ icon, label, value, suffix, accent, valueColor }) {
  return (
    <div className="kpi" style={{ ...styles.kpi, ...(accent ? styles.kpiAccent : {}) }}>
      <div className="kpi-label" style={styles.kpiLabel}>
        <span style={{ opacity: 0.7, marginRight: 6 }}>{icon}</span>
        {label}
      </div>
      <div className="kpi-value" style={{ ...styles.kpiValue, ...(valueColor ? { color: valueColor } : {}) }}>
        {value}
        {suffix && <span style={styles.kpiSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "#05060a",
  border: "1px solid rgba(250,204,21,0.4)",
  borderRadius: 2,
  fontSize: 12,
  color: "#f5f5f5",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
};

const cssText = `
  :root {
    --bg: #05060a;
    --panel: #0d0e12;
    --panel-2: #131519;
    --line: rgba(255,255,255,0.07);
    --line-2: rgba(250,204,21,0.2);
    --text: #f5f5f5;
    --dim: #7d8089;
    --accent: #facc15;
    --accent-soft: #fde047;
    --accent-2: #22d3ee;
    --danger: #ef4444;
    --warn: #fb923c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #05060a; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .pulse { animation: pulse 2s ease-in-out infinite; }
  table tbody tr:hover { background: rgba(250,204,21,0.04); }

  /* Fondo deportivo decorativo */
  .sports-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }

  /* Tablet */
  @media (max-width: 900px) {
    .charts-grid { grid-template-columns: 1fr !important; }
    .sessions-grid { grid-template-columns: 1fr !important; }
  }

  /* Móvil */
  @media (max-width: 640px) {
    .dashboard-root { padding: 14px 10px 40px !important; }
    .dashboard-header { padding-bottom: 14px !important; margin-bottom: 18px !important; gap: 10px !important; }
    .dashboard-header-left { gap: 10px !important; }
    .dashboard-logo { height: 72px !important; }
    .dashboard-title { font-size: 26px !important; line-height: 1 !important; }
    .dashboard-club { font-size: 9px !important; letter-spacing: 0.3em !important; margin-top: 6px !important; }
    .dashboard-eyebrow { font-size: 9px !important; letter-spacing: 0.2em !important; margin-bottom: 6px !important; }
    .dashboard-subtitle { display: none !important; }
    .dashboard-header-right { flex-direction: row !important; justify-content: center !important; align-items: center !important; gap: 10px !important; }
    .dashboard-last-update { text-align: center !important; font-size: 10px !important; }
    .dashboard-refresh-btn { padding: 7px 12px !important; font-size: 10px !important; letter-spacing: 0.05em !important; }
    .dashboard-refresh-btn span { display: none !important; }

    .kpi-grid { grid-template-columns: 1fr 1fr !important; gap: 8px !important; margin-bottom: 20px !important; }
    .kpi-grid > div:last-child { grid-column: 1 / -1; }
    .kpi { padding: 10px 12px !important; }
    .kpi-value { font-size: 22px !important; }
    .kpi-label { font-size: 9px !important; letter-spacing: 0.05em !important; margin-bottom: 6px !important; }

    .filter-bar { margin-bottom: 20px !important; max-width: none !important; padding: 11px 13px 9px !important; }
    .section { margin-bottom: 26px !important; }
    .section-title { font-size: 15px !important; margin-bottom: 12px !important; gap: 8px !important; flex-wrap: wrap !important; }
    .section-num { font-size: 10px !important; padding: 2px 6px !important; }
    .filter-tag { font-size: 11px !important; }

    /* Perfil del atleta */
    .profile-main { padding: 16px 16px !important; gap: 14px !important; }
    .profile-initial { width: 44px !important; height: 44px !important; font-size: 22px !important; }
    .profile-name { font-size: 22px !important; }
    .profile-label { font-size: 8px !important; }
    .profile-stats { grid-template-columns: 1fr 1fr !important; gap: 12px !important; padding-top: 12px !important; }
    .profile-stat-val { font-size: 20px !important; }
    .profile-stat-val-date { font-size: 14px !important; }

    /* Tarjetas de sesión */
    .session-card { padding: 12px 14px !important; gap: 10px !important; }
    .session-athlete { font-size: 16px !important; }
    .session-date { font-size: 11px !important; }
    .session-series { font-size: 20px !important; }
    .session-series-wrap { padding-bottom: 10px !important; gap: 8px !important; }
    .session-recu { padding: 4px 8px !important; gap: 6px !important; }
    .session-body { grid-template-columns: 1fr !important; gap: 12px !important; }
    .session-rpe { flex-direction: row !important; padding: 10px 12px !important; border-top: 1px solid rgba(250,204,21,0.15); gap: 18px !important; }
    .rpe-block { flex: 1; }
    .rpe-value { font-size: 20px !important; }
    .reps-line { grid-template-columns: repeat(auto-fit, minmax(62px, 1fr)) !important; gap: 5px !important; }
    .rep-pill { padding: 8px 8px 6px !important; }
    .rep-time { font-size: 14px !important; }
    .rep-num { font-size: 9px !important; }
    .block-header { font-size: 10px !important; gap: 8px !important; }
    .block-dist { font-size: 9px !important; padding: 2px 5px !important; }
    .session-comment { font-size: 11px !important; padding: 7px 10px !important; }

    /* Selector */
    .select-option-rpe { display: none !important; }

    /* Footer */
    .dashboard-footer { font-size: 10px !important; }
  }
`;

const styles = {
  root: {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at top, #0a0b10 0%, #05060a 70%)",
    color: "var(--text)",
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: "28px 24px 60px",
    fontFeatureSettings: '"tnum" 1, "ss01" 1',
    position: "relative",
    overflow: "hidden",
  },
  sportsBgSvg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 0,
  },
  content: {
    position: "relative",
    zIndex: 1,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    borderBottom: "1px solid var(--line)",
    paddingBottom: 24,
    marginBottom: 32,
    position: "relative",
  },
  headerAccentBar: {
    display: "none",
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    width: "100%",
    maxWidth: 900,
  },
  logo: {
    height: 96,
    width: "auto",
    flexShrink: 0,
    filter: "drop-shadow(0 0 18px rgba(250,204,21,0.35))",
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: "0.25em",
    color: "var(--accent)",
    fontWeight: 700,
    marginBottom: 8,
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: "center",
  },
  title: {
    margin: 0,
    fontSize: 46,
    fontWeight: 900,
    letterSpacing: "-0.04em",
    lineHeight: 0.95,
    textTransform: "uppercase",
  },
  titleAccent: {
    color: "var(--accent)",
    textShadow: "0 0 24px rgba(250,204,21,0.3)",
  },
  club: {
    marginTop: 8,
    color: "var(--accent)",
    fontSize: 11,
    letterSpacing: "0.35em",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    opacity: 0.85,
  },
  subtitle: {
    marginTop: 6,
    color: "var(--dim)",
    fontSize: 13,
    letterSpacing: "0.02em",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  lastUpdate: {
    fontSize: 11,
    color: "var(--dim)",
    textAlign: "right",
    fontFamily: "'JetBrains Mono', monospace",
  },
  refreshHint: {
    fontSize: 9,
    opacity: 0.6,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  refreshBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: 2,
    fontWeight: 800,
    fontSize: 11,
    cursor: "pointer",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    boxShadow: "0 0 0 1px rgba(250,204,21,0.3), 0 0 20px rgba(250,204,21,0.15)",
  },
  errorBox: {
    background: "rgba(249,115,22,0.1)",
    border: "1px solid rgba(249,115,22,0.3)",
    color: "#fdba74",
    padding: "10px 14px",
    borderRadius: 2,
    fontSize: 13,
    marginBottom: 20,
  },
  loading: {
    textAlign: "center",
    padding: 80,
    color: "var(--dim)",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    marginBottom: 32,
  },
  kpi: {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    padding: "16px 18px",
    borderRadius: 2,
    position: "relative",
    overflow: "hidden",
  },
  kpiAccent: {
    borderColor: "var(--line-2)",
    background: "linear-gradient(135deg, rgba(250,204,21,0.06) 0%, var(--panel) 60%)",
  },
  kpiLabel: {
    fontSize: 11,
    color: "var(--dim)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    display: "flex",
    alignItems: "center",
    marginBottom: 10,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  kpiValue: {
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    fontFamily: "'JetBrains Mono', monospace",
  },
  kpiSuffix: {
    fontSize: 14,
    color: "var(--dim)",
    marginLeft: 4,
    fontWeight: 400,
  },
  filterBar: {
    marginBottom: 32,
    maxWidth: 860,
    padding: "14px 16px 12px",
    background: "rgba(250,204,21,0.04)",
    border: "1px solid rgba(250,204,21,0.45)",
    borderRadius: 3,
    boxShadow: "0 0 0 1px rgba(250,204,21,0.15), 0 0 20px rgba(250,204,21,0.2), inset 0 0 20px rgba(250,204,21,0.04)",
  },
  filtersRow: {
    display: "flex",
    gap: 20,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  yearFilter: {
    minWidth: 240,
    flexShrink: 0,
  },
  yearChips: {
    display: "flex",
    gap: 5,
    flexWrap: "wrap",
    paddingTop: 2,
  },
  yearChip: {
    background: "transparent",
    border: "1px solid rgba(250,204,21,0.25)",
    color: "var(--dim)",
    padding: "7px 11px",
    borderRadius: 2,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    letterSpacing: "0.05em",
    transition: "all 0.15s",
  },
  yearChipActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    boxShadow: "0 0 8px rgba(250,204,21,0.3)",
  },
  filterLabel: {
    display: "block",
    fontSize: 10,
    letterSpacing: "0.25em",
    color: "var(--accent)",
    fontWeight: 700,
    marginBottom: 8,
    fontFamily: "'JetBrains Mono', monospace",
    textShadow: "0 0 8px rgba(250,204,21,0.5)",
  },
  selectWrap: {
    position: "relative",
  },
  selectRow: {
    display: "flex",
    gap: 6,
    alignItems: "stretch",
  },
  selectBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "var(--panel)",
    border: "1px solid var(--line)",
    color: "var(--text)",
    padding: "11px 14px",
    borderRadius: 2,
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
    transition: "border-color 0.15s",
    textAlign: "left",
    fontFamily: "inherit",
  },
  selectBtnActive: {
    borderColor: "var(--accent)",
    background: "linear-gradient(90deg, rgba(250,204,21,0.1) 0%, rgba(250,204,21,0.02) 100%)",
    boxShadow: "inset 0 0 0 1px rgba(250,204,21,0.15)",
  },
  selectBtnLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  selectDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
    boxShadow: "0 0 8px rgba(212,255,46,0.6)",
  },
  selectSelectedName: {
    fontWeight: 700,
    fontSize: 14,
  },
  selectCount: {
    fontSize: 11,
    color: "var(--dim)",
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(255,255,255,0.04)",
    padding: "2px 7px",
    borderRadius: 2,
    marginLeft: "auto",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid var(--line)",
    color: "var(--dim)",
    padding: "0 12px",
    borderRadius: 2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  },
  selectDropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: 2,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 20,
    overflow: "hidden",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid var(--line)",
    background: "var(--panel)",
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "inherit",
  },
  selectList: {
    maxHeight: 280,
    overflowY: "auto",
    padding: 4,
  },
  selectOption: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    fontSize: 13,
    cursor: "pointer",
    borderRadius: 2,
    transition: "background 0.1s",
  },
  selectOptionActive: {
    background: "rgba(212,255,46,0.1)",
    color: "var(--accent)",
  },
  selectOptionMeta: {
    fontSize: 10,
    color: "var(--dim)",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  selectOptionRpe: {
    fontSize: 10,
    color: "var(--accent-2)",
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(34,211,238,0.08)",
    padding: "2px 6px",
    borderRadius: 2,
  },
  selectEmpty: {
    padding: "20px 12px",
    textAlign: "center",
    color: "var(--dim)",
    fontSize: 12,
  },
  section: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 900,
    margin: "0 0 20px 0",
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    letterSpacing: "-0.02em",
    textTransform: "uppercase",
  },
  sectionNum: {
    fontSize: 12,
    color: "var(--accent)",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 800,
    background: "rgba(250,204,21,0.1)",
    padding: "3px 8px",
    borderRadius: 2,
    border: "1px solid var(--line-2)",
    letterSpacing: "0.1em",
  },
  filterTag: {
    fontSize: 13,
    color: "var(--accent)",
    fontWeight: 500,
    marginLeft: 4,
  },
  sessionsCount: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--dim)",
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(255,255,255,0.04)",
    padding: "3px 9px",
    borderRadius: 2,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
  },
  athleteCard: {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    padding: 14,
    borderRadius: 2,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  athleteCardActive: {
    borderColor: "var(--accent)",
    background: "rgba(212,255,46,0.06)",
  },
  athleteCardDim: {
    opacity: 0.45,
  },
  athleteName: {
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 12,
  },
  athleteStats: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    marginBottom: 10,
  },
  statVal: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 10,
    color: "var(--dim)",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  athleteLast: {
    fontSize: 11,
    color: "var(--dim)",
    borderTop: "1px solid var(--line)",
    paddingTop: 8,
    fontFamily: "'JetBrains Mono', monospace",
  },
  tableWrap: {
    overflowX: "auto",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 2,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  mono: {
    fontFamily: "'JetBrains Mono', monospace",
  },
  dim: {
    color: "var(--dim)",
  },
  athCell: {
    fontWeight: 600,
  },
  // === Perfil del atleta ===
  profileCard: {
    display: "flex",
    background: "linear-gradient(135deg, rgba(250,204,21,0.08) 0%, rgba(250,204,21,0.02) 40%, transparent 100%)",
    border: "1px solid var(--line-2)",
    borderRadius: 2,
    overflow: "hidden",
    position: "relative",
  },
  profileStripe: {
    width: 6,
    background: "var(--accent)",
    flexShrink: 0,
    boxShadow: "0 0 16px rgba(250,204,21,0.4)",
  },
  profileMain: {
    flex: 1,
    padding: "22px 26px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  profileNameRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  profileInitial: {
    width: 54,
    height: 54,
    borderRadius: 2,
    background: "var(--accent)",
    color: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "-0.04em",
    boxShadow: "0 0 20px rgba(250,204,21,0.3)",
  },
  profileLabel: {
    fontSize: 9,
    letterSpacing: "0.25em",
    color: "var(--dim)",
    textTransform: "uppercase",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    marginBottom: 4,
  },
  profileName: {
    fontSize: 32,
    fontWeight: 900,
    letterSpacing: "-0.03em",
    lineHeight: 1,
    textTransform: "uppercase",
  },
  profileStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--line)",
  },
  profileStat: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  profileStatLabel: {
    fontSize: 9,
    letterSpacing: "0.2em",
    color: "var(--dim)",
    textTransform: "uppercase",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
  },
  profileStatVal: {
    fontSize: 26,
    fontWeight: 800,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "-0.03em",
    lineHeight: 1,
  },
  profileStatSuffix: {
    fontSize: 12,
    color: "var(--dim)",
    marginLeft: 3,
    fontWeight: 400,
  },

  // Mini-panel de distancia-media dentro de cada tarjeta (debajo del RPE)
  sessionDistPanel: {
    marginTop: 4,
    paddingTop: 10,
    borderTop: "1px solid rgba(0,0,0,0.1)",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  sessionDistRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
  },
  sessionDistD: {
    color: "#b45309",
    fontWeight: 800,
    minWidth: 40,
  },
  sessionDistArrow: {
    color: "#78716c",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "-0.05em",
    margin: "0 2px",
  },
  sessionDistM: {
    color: "#0a0b0d",
    fontWeight: 700,
    flex: 1,
  },

  // === Session cards ===
  sessionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
    gap: 14,
  },
  sessionCard: {
    background: "#fafafa",
    border: "1px solid rgba(0,0,0,0.08)",
    borderLeft: "3px solid var(--accent)",
    borderRadius: 2,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    position: "relative",
    overflow: "hidden",
    color: "#1a1a1a",
    boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
  },
  sessionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    position: "relative",
    zIndex: 1,
  },
  sessionDate: {
    fontSize: 12,
    color: "#b45309",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  sessionAthlete: {
    fontSize: 18,
    fontWeight: 800,
    marginTop: 2,
    letterSpacing: "-0.01em",
    color: "#0a0b0d",
    textTransform: "uppercase",
  },
  sessionBadges: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  badge: {
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.1)",
    color: "#4b5563",
    fontSize: 10,
    padding: "3px 8px",
    borderRadius: 2,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  sessionSeriesWrap: {
    position: "relative",
    paddingBottom: 12,
    borderBottom: "1px dashed rgba(0,0,0,0.12)",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
    flexWrap: "wrap",
  },
  sessionSeries: {
    fontSize: 24,
    fontWeight: 900,
    color: "#0a0b0d",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "-0.03em",
    fontStyle: "italic",
    position: "relative",
    zIndex: 1,
    lineHeight: 1.05,
    minWidth: 0,
    flex: "0 0 auto",
  },
  sessionRecu: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 7,
    background: "rgba(34,211,238,0.1)",
    border: "1px solid rgba(6,182,212,0.4)",
    padding: "5px 10px 5px 9px",
    borderRadius: 2,
    flexShrink: 0,
  },
  sessionRecuLabel: {
    fontSize: 9,
    color: "#0891b2",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.15em",
    fontWeight: 700,
  },
  sessionRecuValue: {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    color: "#0e7490",
    letterSpacing: "-0.01em",
  },
  sessionBody: {
    display: "grid",
    gridTemplateColumns: "1fr 130px",
    gap: 16,
    alignItems: "start",
  },
  sessionRepsWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minWidth: 0,
  },
  blockRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  blockHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 11,
  },
  blockLabel: {
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#6b7280",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
  },
  blockDist: {
    background: "#ca8a04",
    color: "#fff",
    padding: "2px 7px",
    borderRadius: 2,
    fontWeight: 800,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
  },
  blockMedia: {
    color: "#374151",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
  },
  blockPerd: {
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 800,
    marginLeft: "auto",
    fontSize: 12,
  },
  repsLine: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(76px, 1fr))",
    gap: 7,
  },
  repPill: {
    background: "#ffffff",
    border: "1px solid rgba(202,138,4,0.3)",
    borderRadius: 3,
    padding: "10px 10px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
    minWidth: 0,
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  repNum: {
    fontSize: 10,
    color: "#ca8a04",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.12em",
    fontWeight: 700,
  },
  repTime: {
    fontSize: 16,
    fontWeight: 800,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "-0.02em",
    color: "#0a0b0d",
  },
  repBarTrack: {
    height: 4,
    background: "rgba(0,0,0,0.08)",
    borderRadius: 2,
    overflow: "hidden",
  },
  repBarFill: {
    height: "100%",
    transition: "width 0.4s ease",
  },
  sessionRpe: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 12px",
    background: "rgba(250,204,21,0.08)",
    border: "1px solid rgba(202,138,4,0.35)",
    borderRadius: 3,
    alignSelf: "stretch",
  },
  rpeBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  rpeLabel: {
    fontSize: 10,
    color: "#b45309",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 900,
  },
  rpeValue: {
    fontSize: 26,
    fontWeight: 800,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "-0.03em",
    lineHeight: 1,
  },
  rpeMax: {
    fontSize: 12,
    color: "#6b7280",
    marginLeft: 3,
    fontWeight: 500,
  },
  rpeDots: {
    display: "grid",
    gridTemplateColumns: "repeat(10, 1fr)",
    gap: 2,
    marginTop: 4,
  },
  rpeDot: {
    height: 5,
    borderRadius: 1,
  },
  sessionComment: {
    background: "rgba(34,197,94,0.1)",
    border: "1px solid rgba(34,197,94,0.35)",
    borderLeft: "3px solid #16a34a",
    borderRadius: 2,
    padding: "10px 14px",
    fontSize: 13,
    color: "#14532d",
    fontStyle: "normal",
    lineHeight: 1.55,
    position: "relative",
    fontWeight: 500,
  },
  commentQuote: {
    color: "#16a34a",
    fontSize: 20,
    fontWeight: 800,
    marginRight: 8,
    fontStyle: "normal",
    verticalAlign: "-4px",
  },

  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  chartCard: {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    padding: "16px 14px 10px",
    borderRadius: 2,
  },
  chartTitle: {
    fontSize: 11,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: "var(--dim)",
    marginBottom: 8,
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: "1px solid var(--line)",
    fontSize: 11,
    color: "var(--dim)",
    textAlign: "center",
    fontFamily: "'JetBrains Mono', monospace",
  },
};

// Estilos inyectados en la tabla (thead)
const tableHeadCss = document.createElement("style");
tableHeadCss.textContent = `
  table th {
    text-align: left;
    padding: 10px 12px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b8f98;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: #16181c;
    font-weight: 600;
    white-space: nowrap;
  }
  table td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    vertical-align: middle;
    white-space: nowrap;
  }
  table td:last-child { white-space: normal; }
`;
if (typeof document !== "undefined" && !document.getElementById("table-styles")) {
  tableHeadCss.id = "table-styles";
  document.head.appendChild(tableHeadCss);
}
